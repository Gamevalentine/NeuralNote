//
// Created by Damien Ronssin on 12.09.26.
//

#include "ModelDownloader.h"

#include <atomic>

#include "ModelManifest.h"
#include "NNFileUtils.h"
#include "NnLogger.h"

namespace
{
constexpr int CONNECTION_TIMEOUT_MS = 30000;

// HuggingFace answers every file with a redirect to its CDN, which honours the Range header.
constexpr int MAX_REDIRECTS = 5;

constexpr int CHUNK_BYTES = 1 << 20;

// Delays before the attempts that follow a failed one. Reset whenever an attempt writes something,
// so a long download is not given up on because of a few drops spread across it.
constexpr std::array<int, 3> RETRY_DELAYS_MS = {2000, 5000, 10000};

juce::URL getModelUrl(ModelSize inModelSize)
{
    return juce::URL("https://huggingface.co/" + juce::String(MODEL_REPO) + "/resolve/" + MODEL_REVISION + "/"
                     + MODEL_REPO_DIRECTORY + "/" + getModelManifestEntry(inModelSize).fileName);
}

size_t indexOf(ModelSize inModelSize)
{
    return static_cast<size_t>(inModelSize);
}
} // namespace

class ModelDownloader::Job : public juce::Thread
{
public:
    explicit Job(ModelSize inModelSize)
        : juce::Thread("NeuralNote model download (" + juce::String(modelSizeToString(inModelSize)) + ")")
        , mModelSize(inModelSize)
    {
    }

    ~Job() override
    {
        requestStop();

        // Not bounded: a timeout here kills the thread, and verifying the large checkpoint takes
        // seconds with nothing to interrupt it.
        stopThread(-1);
    }

    void begin()
    {
        if (isThreadRunning()) {
            return;
        }

        // Before the thread starts, so a status read in between does not see the last run's phase.
        mDownloadedBytes = NNFileUtils::getModelPartFile(mModelSize).getSize();
        mPhase = Phase::Downloading;

        // Consumes a notify() left by a stop that found no retry delay to wake.
        wait(0);

        startThread();
    }

    void requestStop()
    {
        signalThreadShouldExit();

        // Wakes a retry delay.
        notify();

        const juce::ScopedLock lock(mStreamLock);

        if (mStream != nullptr) {
            mStream->cancel();
        }
    }

    Status getStatus() const
    {
        Status status;
        status.phase = mPhase.load();
        status.totalBytes = getModelManifestEntry(mModelSize).numBytes;
        status.downloadedBytes =
            status.isBusy() ? mDownloadedBytes.load() : NNFileUtils::getModelPartFile(mModelSize).getSize();

        if (status.phase == Phase::Failed) {
            const juce::ScopedLock lock(mErrorLock);
            status.errorMessage = mErrorMessage;
        }

        return status;
    }

private:
    /** How one request ended. An empty failure means the part file is complete. */
    struct Attempt {
        juce::String failure;
        bool canRetry = true;
    };

    void run() override
    {
        const juce::String failure = _download();

        if (failure.isNotEmpty() && !threadShouldExit()) {
            NnLogger::write(NnLogger::Level::Warning,
                            "ModelDownloader: " + juce::String(modelSizeToString(mModelSize)) + ": " + failure);

            const juce::ScopedLock lock(mErrorLock);
            mErrorMessage = failure;
            mPhase = Phase::Failed;
        } else {
            mPhase = Phase::Idle;
        }
    }

    /** @return Why it failed, or empty once installed or cancelled. */
    juce::String _download()
    {
        const ModelManifestEntry& entry = getModelManifestEntry(mModelSize);

        if (NNFileUtils::isModelInstalled(mModelSize)) {
            return {};
        }

        // Instances in this process share this object and cannot get here twice for one size. The
        // lock is for another process: a standalone next to a host, or a host that runs plugins out
        // of process.
        juce::InterProcessLock process_lock("NeuralNoteModelDownload_" + juce::String(modelSizeToString(mModelSize)));

        if (!process_lock.enter(0)) {
            return "Một phiên NOTIQ khác đang tải mô hình này";
        }

        const juce::File directory = NNFileUtils::getModelsDirectory();

        if (!NNFileUtils::ensureDirectoryExists(directory)) {
            return "Không thể tạo " + directory.getFullPathName();
        }

        const juce::File part = NNFileUtils::getModelPartFile(mModelSize);
        _deleteOtherPartFiles(part);

        size_t failed_attempts = 0;

        while (part.getSize() != entry.numBytes) {
            const juce::int64 size_before = part.getSize();
            const Attempt attempt = _attempt(part, entry);

            if (threadShouldExit()) {
                return {};
            }

            if (attempt.failure.isEmpty()) {
                continue;
            }

            if (!attempt.canRetry) {
                return attempt.failure;
            }

            if (part.getSize() > size_before) {
                failed_attempts = 0;
            }

            if (failed_attempts == RETRY_DELAYS_MS.size()) {
                return attempt.failure;
            }

            wait(RETRY_DELAYS_MS[failed_attempts++]);

            if (threadShouldExit()) {
                return {};
            }
        }

        mPhase = Phase::Verifying;

        const juce::String digest = juce::SHA256(part).toHexString();

        if (threadShouldExit()) {
            return {};
        }

        if (digest != entry.sha256) {
            NnLogger::write(NnLogger::Level::Error,
                            "ModelDownloader: " + juce::String(modelSizeToString(mModelSize))
                                + ": checksum mismatch, got " + digest);
            part.deleteFile();
            return "Tệp tải về bị hỏng. Hãy thử lại";
        }

        // Replaces a checkpoint of the wrong size, which is what a file from another release is.
        if (!part.moveFileTo(NNFileUtils::getModelFile(mModelSize))) {
            return "Không thể chuyển mô hình vào " + directory.getFullPathName();
        }

        NnLogger::write(NnLogger::Level::Info,
                        "ModelDownloader: " + juce::String(modelSizeToString(mModelSize)) + " installed");
        return {};
    }

    /** One request, from wherever the part file ends. */
    Attempt _attempt(const juce::File& inPart, const ModelManifestEntry& inEntry)
    {
        juce::int64 offset = inPart.getSize();

        if (offset > inEntry.numBytes) {
            inPart.deleteFile();
            offset = 0;
        }

        mDownloadedBytes = offset;

        juce::WebInputStream stream(getModelUrl(mModelSize), false);
        stream.withConnectionTimeout(CONNECTION_TIMEOUT_MS).withNumRedirectsToFollow(MAX_REDIRECTS);

        if (offset > 0) {
            stream.withExtraHeaders("Range: bytes=" + juce::String(offset) + "-");
        }

        {
            const juce::ScopedLock lock(mStreamLock);
            mStream = &stream;
        }

        // Declared after the stream, so it runs before the stream is destroyed.
        const juce::ScopeGuard forget_stream {[this] {
            const juce::ScopedLock lock(mStreamLock);
            mStream = nullptr;
        }};

        // A stop requested before mStream was published cancelled nothing.
        if (threadShouldExit()) {
            return {};
        }

        if (!stream.connect(nullptr)) {
            return {"Không thể kết nối huggingface.co"};
        }

        const int status_code = stream.getStatusCode();
        const juce::String content_range = stream.getResponseHeaders()["Content-Range"];

        NnLogger::write(NnLogger::Level::Info,
                        "ModelDownloader: " + juce::String(modelSizeToString(mModelSize)) + ": from byte "
                            + juce::String(offset) + ", HTTP " + juce::String(status_code)
                            + (content_range.isEmpty() ? juce::String() : ", Content-Range " + content_range));

        if (status_code == 206) {
            // "bytes <first>-<last>/<total>"
            const bool range_matches =
                content_range.startsWith("bytes " + juce::String(offset) + "-")
                && content_range.fromLastOccurrenceOf("/", false, false).getLargeIntValue() == inEntry.numBytes;

            // Not a continuation of the part file: start again, as for 416.
            if (!range_matches) {
                inPart.deleteFile();
                return {"Máy chủ huggingface.co trả về phản hồi không hợp lệ"};
            }
        } else if (status_code == 200) {
            // The whole file, whether or not a range was asked for.
            if (offset > 0 && !inPart.deleteFile()) {
                return {"Không thể ghi vào " + inPart.getFullPathName(), false};
            }

            offset = 0;
            mDownloadedBytes = 0;
        } else if (status_code == 416) {
            // The part file is not a prefix the server recognises: start again.
            inPart.deleteFile();
            return {"Không thể tiếp tục tải phần còn lại"};
        } else {
            return {"huggingface.co trả về HTTP " + juce::String(status_code), status_code >= 500};
        }

        juce::FileOutputStream output(inPart);

        if (output.failedToOpen()) {
            return {"Không thể ghi vào " + inPart.getFullPathName(), false};
        }

        juce::HeapBlock<char> buffer(CHUNK_BYTES);

        while (!threadShouldExit()) {
            const int num_read = stream.read(buffer.get(), CHUNK_BYTES);

            if (num_read <= 0) {
                break;
            }

            if (mDownloadedBytes.load() + num_read > inEntry.numBytes) {
                return {"huggingface.co gửi dữ liệu vượt kích thước dự kiến", false};
            }

            if (!output.write(buffer.get(), static_cast<size_t>(num_read))) {
                return {"Không thể ghi vào " + inPart.getFullPathName(), false};
            }

            mDownloadedBytes += num_read;
        }

        output.flush();

        if (output.getStatus().failed()) {
            return {"Không thể ghi vào " + inPart.getFullPathName(), false};
        }

        // A connection that drops mid-body ends the stream early rather than reporting an error.
        if (mDownloadedBytes.load() != inEntry.numBytes) {
            return {"Mất kết nối mạng"};
        }

        return {};
    }

    /** A part named for another digest was started by a build pinned to other weights. */
    static void _deleteOtherPartFiles(const juce::File& inPart)
    {
        const juce::String pattern = inPart.getFileName().upToFirstOccurrenceOf(".gguf", true, false) + ".*.part";

        for (const juce::File& file:
             inPart.getParentDirectory().findChildFiles(juce::File::findFiles, false, pattern)) {
            if (file != inPart) {
                file.deleteFile();
            }
        }
    }

    const ModelSize mModelSize;

    std::atomic<Phase> mPhase {Phase::Idle};
    std::atomic<juce::int64> mDownloadedBytes {0};

    juce::CriticalSection mErrorLock;
    juce::String mErrorMessage;

    // The request in flight, for requestStop to cancel from another thread.
    juce::CriticalSection mStreamLock;
    juce::WebInputStream* mStream = nullptr;
};

float ModelDownloader::Status::getProgress() const
{
    if (totalBytes <= 0) {
        return 0.0f;
    }

    return juce::jlimit(
        0.0f, 1.0f, static_cast<float>(static_cast<double>(downloadedBytes) / static_cast<double>(totalBytes)));
}

ModelDownloader::ModelDownloader()
{
    for (const ModelSize size: ALL_MODEL_SIZES) {
        mJobs[indexOf(size)] = std::make_unique<Job>(size);
    }
}

ModelDownloader::~ModelDownloader()
{
    // All at once, so they wind down together rather than one after the other as each is destroyed.
    for (auto& job: mJobs) {
        job->requestStop();
    }
}

void ModelDownloader::start(ModelSize inModelSize)
{
    mJobs[indexOf(inModelSize)]->begin();
}

void ModelDownloader::cancel(ModelSize inModelSize)
{
    mJobs[indexOf(inModelSize)]->requestStop();
}

ModelDownloader::Status ModelDownloader::getStatus(ModelSize inModelSize) const
{
    return mJobs[indexOf(inModelSize)]->getStatus();
}
