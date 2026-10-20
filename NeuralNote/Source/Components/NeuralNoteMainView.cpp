//
// Created by Damien Ronssin on 06.03.23.
//

#include "NeuralNoteMainView.h"

#include "ComputeDevices.h"
#include "CrashReporter.h"
#include "MidiFileWriter.h"
#include "NeuralNoteTooltips.h"
#include "NNFileUtils.h"
#include "NnFonts.h"
#include "NnGlobalSettings.h"
#include "NnLogger.h"
#include "NnLook.h"
#include "PluginEditor.h"

namespace
{
/** Between the update notification and the status bar below it. */
constexpr int UPDATE_NOTIFICATION_GAP = 10;
} // namespace

NeuralNoteMainView::NeuralNoteMainView(NeuralNoteAudioProcessor& processor)
    : mProcessor(processor)
    , mTopBar(processor)
    , mSidebar(processor)
    , mVisualizationPanel(&processor)
    , mInstrumentMenu(processor)
{
    mProcessor.addListenerToStateValueTree(this);
    jassert(mProcessor.getValueTree().hasProperty(NnId::PlayheadCenteredId));

    // The eight compact menus mirror NOTIQ Web. Native commands still call the
    // original JUCE player, transcriber, mixer and MIDI export implementation.
    constexpr std::array<const char*, 8> titles {
        "Tệp", "Chỉnh sửa", "Phát lại", "Track MIDI",
        "Nhạc cụ", "Công cụ", "Hiển thị", "Xuất"
    };
    for (std::size_t i = 0; i < titles.size(); ++i) {
        auto button = std::make_unique<NnFlatButton>(juce::String::fromUTF8(titles[i]));
        button->setLabel(juce::String::fromUTF8(titles[i]), nn::fonts::buttonLabel());
        button->setPadding(8, 8, 0);
        button->setCornerRadius(0.0f);
        button->setColour(NnFlatButton::backgroundColourId, nn::colours::bgTopBar);
        button->setColour(NnFlatButton::backgroundOnColourId, nn::colours::bgControlActive);
        button->setColour(NnFlatButton::textColourId, nn::colours::textPrimary);
        button->setColour(NnFlatButton::textOnColourId, nn::colours::textBright);
        button->setWantsKeyboardFocus(false);
        button->onClick = [this, index = static_cast<int>(i)] { _showWebStyleMenu(index); };
        addAndMakeVisible(*button);
        mWebMenuButtons[i] = std::move(button);
    }

    addAndMakeVisible(mTopBar);
    mTopBar.setVisible(false);
    addAndMakeVisible(mSidebar);
    addAndMakeVisible(mVisualizationPanel);

    addChildComponent(mInstrumentMenu);
    mInstrumentMenu.onDismiss = [this] { _setInstrumentMenuOpen(false); };

    // Only ever opens: while the menu is up its scrim covers the "+" as well, so a second click
    // there is the click that closes it.
    mSidebar.onAddInstrument = [this] { _setInstrumentMenuOpen(true); };

    mUpdateCheck = std::make_unique<UpdateCheck>();

    // Off this thread: the first listing initialises the GPU backends.
    ComputeDevices::prepare();

    mTopBar.getModelButton().onClick = [this] {
        mVisualizationPanel.setModelPanelOpen(!mVisualizationPanel.isModelPanelVisible());
        mTopBar.syncModelButton(mVisualizationPanel.isModelPanelVisible());
    };

    mTopBar.getSettingsButton().onClick = [this] {
        _buildSettingsMenu();
        mSettingsMenu->showMenuAsync(PopupMenu::Options().withTargetComponent(&mTopBar.getSettingsButton()));
    };

    mTopBar.getFollowButton().getToggleStateValue().referTo(
        mProcessor.getValueTree().getPropertyAsValue(NnId::PlayheadCenteredId, nullptr));
    NeuralNoteMainView::valueTreePropertyChanged(mProcessor.getValueTree(), NnId::PlayheadCenteredId);

    mTopBar.getLoopButton().getToggleStateValue().referTo(
        mProcessor.getValueTree().getPropertyAsValue(NnId::LoopEnabledId, nullptr));

    mTopBar.getBackButton().onClick = [this] {
        mProcessor.getPlayer()->returnToStart();
        mTopBar.syncTransportToggles();
        mVisualizationPanel.getAudioMidiViewport().setViewPositionProportionately(0, 0);
    };

    _updateTooltipVisibility();

    setWantsKeyboardFocus(true);

    updateEnablements();

    addChildComponent(mUpdateCheck.get());
    mUpdateCheck->checkForUpdate(false);

    // Only to notice the processor state and the transport changing under the UI. Nothing here
    // repaints unconditionally: everything that moves per frame is on a vblank callback of its own.
    startTimerHz(20);
}

NeuralNoteMainView::~NeuralNoteMainView()
{
    mProcessor.removeListenerFromStateValueTree(this);
}

void NeuralNoteMainView::resized()
{
    auto bounds = getLocalBounds();

    mWebMenuBounds = bounds.removeFromTop(40);
    const int widths[] = {47, 79, 69, 89, 76, 72, 76, 51};
    int x = 164;
    for (std::size_t i = 0; i < mWebMenuButtons.size(); ++i) {
        mWebMenuButtons[i]->setBounds(x, mWebMenuBounds.getY() + 4, widths[i], 32);
        x += widths[i];
    }

    // Show the legacy sound/transport controls on demand. Nothing is deleted:
    // playback, master gain, recording, BPM editing and MIDI drag remain intact.
    mTopBar.setVisible(mShowAdvancedControls);
    mTopBar.setBounds(bounds.removeFromTop(mShowAdvancedControls ? nn::metrics::topBarHeight : 0));
    mSidebar.setBounds(bounds.removeFromLeft(nn::metrics::sidebarWidth));
    mVisualizationPanel.setCompactMode(!mShowAdvancedControls);
    mVisualizationPanel.setBounds(bounds);

    // Just above the status bar. Wider than the panel needs -- it sizes itself to its message and
    // pins itself to the right of this, so what is set here is the room it has to grow into.
    mUpdateCheck->setBounds(bounds.getRight() - 460,
                            bounds.getBottom() - nn::metrics::statusBarHeight - UPDATE_NOTIFICATION_GAP
                                - nn::metrics::menuRowHeight,
                            460 - nn::metrics::menuPadX,
                            nn::metrics::menuRowHeight);

    mInstrumentMenu.setBounds(getLocalBounds());
    mInstrumentMenu.setPanelAnchor(mSidebar.getPosition() + mSidebar.getMenuAnchor());
}

void NeuralNoteMainView::_setInstrumentMenuOpen(bool inIsOpen)
{
    mInstrumentMenu.setVisible(inIsOpen);
    mSidebar.setMenuOpen(inIsOpen);

    if (inIsOpen) {
        // Above the update notification, which is added after it and would otherwise sit on top.
        mInstrumentMenu.toFront(false);
    }

    if (!inIsOpen) {
        // The transport shortcuts live here, and the menu took the focus to hear Escape.
        grabKeyboardFocus();
    }
}

void NeuralNoteMainView::paint(Graphics& g)
{
    g.fillAll(nn::colours::bgRoot);
    g.setColour(nn::colours::bgTopBar);
    g.fillRect(mWebMenuBounds);
    nn::drawBottomBorder(g, mWebMenuBounds, nn::colours::divStrong);

    g.setColour(nn::colours::textBright);
    g.setFont(nn::fonts::wordmark());
    g.drawText("NOTIQ", 14, mWebMenuBounds.getY(), 83, mWebMenuBounds.getHeight(),
               juce::Justification::centredLeft, false);
    g.setColour(nn::colours::accentText);
    g.setFont(nn::fonts::pillLabel());
    g.drawText("DESKTOP", 92, mWebMenuBounds.getY(), 75, mWebMenuBounds.getHeight(),
               juce::Justification::centredLeft, false);
    g.setColour(nn::colours::textPrimary);
    g.drawText("LUNOR MUSIC", getWidth() - 150, mWebMenuBounds.getY(), 135,
               mWebMenuBounds.getHeight(), juce::Justification::centredRight, false);
}

void NeuralNoteMainView::timerCallback()
{
    mTopBar.syncTransportToggles();

    // The model panel changes what the button shows -- its cross, its selection -- without telling it.
    mTopBar.syncModelButton(mVisualizationPanel.isModelPanelVisible());

    const State processor_state = mProcessor.getState();

    if (mPrevState != processor_state) {
        mPrevState = processor_state;
        updateEnablements();
    }
}

void NeuralNoteMainView::openAudioFile()
{
    mVisualizationPanel.getCombinedAudioMidiRegion().getAudioRegion()->openFileChooser();
}

void NeuralNoteMainView::repaintPianoRoll()
{
    mVisualizationPanel.repaintPianoRoll();
}

void NeuralNoteMainView::clear()
{
    jassert(MessageManager::getInstance()->isThisTheMessageThread());

    mVisualizationPanel.clear();
    updateEnablements();
}

bool NeuralNoteMainView::keyPressed(const KeyPress& key)
{
    if (key == KeyPress(KeyPress::spaceKey, ModifierKeys::shiftModifier, 0)) {
        mTopBar.getBackButton().triggerClick();
        return true;
    }

    if (key == KeyPress::spaceKey) {
        mTopBar.getPlayPauseButton().triggerClick();
        return true;
    }

    if (key == KeyPress(KeyPress::backspaceKey, ModifierKeys::shiftModifier, 0)) {
        mVisualizationPanel.getToolbar().getClearButton().triggerClick();
        return true;
    }

    if (key == KeyPress('r', juce::ModifierKeys::noModifiers, 0)) {
        mTopBar.getRecordButton().triggerClick();
        return true;
    }

    if (key == KeyPress('m', juce::ModifierKeys::noModifiers, 0)) {
        mTopBar.getMuteButton().triggerClick();
        return true;
    }

    if (key == KeyPress('c', juce::ModifierKeys::noModifiers, 0)) {
        mTopBar.getFollowButton().triggerClick();
        return true;
    }

    if (key == KeyPress('l', juce::ModifierKeys::noModifiers, 0)) {
        mTopBar.getLoopButton().triggerClick();
        return true;
    }

    return false;
}

void NeuralNoteMainView::updateEnablements()
{
    mPrevState = mProcessor.getState();

    mTopBar.updateEnablements();
    mTopBar.syncTransportToggles();
    mSidebar.updateEnablements();
    mVisualizationPanel.updateEnablements();

    // The selection is fixed once a transcription exists, and the "+" goes away with it. A menu
    // left open over that would be offering a choice that no longer applies.
    if (mProcessor.hasTranscription() && mInstrumentMenu.isVisible()) {
        _setInstrumentMenuOpen(false);
    }
}

void NeuralNoteMainView::valueTreePropertyChanged(ValueTree& treeWhosePropertyHasChanged, const Identifier& property)
{
    if (property == NnId::PlayheadCenteredId) {
        const bool should_center = treeWhosePropertyHasChanged.getProperty(property);
        mTopBar.getFollowButton().setToggleState(should_center, sendNotification);
        mVisualizationPanel.getCombinedAudioMidiRegion().setCenterView(should_center);
    }

    if (property == NnId::SelectedInstrumentGroupsId) {
        // The transcribe button names how many instruments it is about to look for.
        mVisualizationPanel.updateEnablements();
    }
}


void NeuralNoteMainView::_showWebStyleMenu(int index)
{
    juce::PopupMenu menu;
    const auto state = mProcessor.getState();
    const bool hasAudio = state == AudioLoaded || state == Processing
                          || state == Paused || state == PopulatedAudioAndMidiRegions;
    const bool canLoad = state != Recording && state != Processing;
    const bool hasMidi = state == PopulatedAudioAndMidiRegions;
    switch (index) {
        case 0: // Tệp
            menu.addItem(101, juce::String::fromUTF8("Mở tệp âm thanh..."), canLoad);
            menu.addItem(102, juce::String::fromUTF8("Đóng tệp / xóa dữ liệu"), hasAudio);
            break;
        case 1: // Chỉnh sửa
            menu.addItem(201, juce::String::fromUTF8("Xóa nốt / kết quả nhận diện"), hasAudio);
            menu.addItem(202, juce::String::fromUTF8("Về đầu bản nhạc"), mProcessor.canPlay());
            break;
        case 2: // Phát lại
            menu.addItem(301, juce::String::fromUTF8("Phát / Tạm dừng"), mProcessor.canPlay());
            menu.addItem(302, juce::String::fromUTF8("Về đầu"), mProcessor.canPlay());
            menu.addItem(303, juce::String::fromUTF8("Phát lặp"), true, mTopBar.getLoopButton().getToggleState());
            menu.addSeparator();
            menu.addItem(304, juce::String::fromUTF8("Hiện bộ điều khiển âm thanh..."), true);
            break;
        case 3: // Track MIDI
            menu.addItem(401, juce::String::fromUTF8("Thêm / chọn nhạc cụ"), true);
            menu.addItem(402, juce::String::fromUTF8("Xóa nốt đang nhận diện"), hasAudio);
            break;
        case 4: // Nhạc cụ
            menu.addItem(501, juce::String::fromUTF8("Chọn nhạc cụ cần nhận diện..."), true);
            menu.addItem(502, juce::String::fromUTF8("Điều chỉnh âm lượng / Solo / Mute..."), true);
            break;
        case 5: // Công cụ
            menu.addItem(601, juce::String::fromUTF8("Nhận diện Audio → MIDI"), state == AudioLoaded);
            menu.addItem(602, juce::String::fromUTF8("Chọn / tải mô hình AI..."));
            menu.addItem(603, juce::String::fromUTF8("Cài đặt NOTIQ..."));
            break;
        case 6: // Hiển thị
            menu.addItem(701, juce::String::fromUTF8("Thanh điều khiển nâng cao"), true, mShowAdvancedControls);
            menu.addItem(702, juce::String::fromUTF8("Đặt lại thu phóng Piano Roll"));
            break;
        case 7: // Xuất
            menu.addItem(801, juce::String::fromUTF8("Xuất tệp MIDI (.mid)..."), hasMidi);
            {
                juce::PopupMenu bpm;
                const double currentBpm = mProcessor.getValueTree().getProperty(NnId::ExportTempoId, 120.0);
                bpm.addItem(811, "90 BPM", true, juce::approximatelyEqual(currentBpm, 90.0));
                bpm.addItem(812, "120 BPM", true, juce::approximatelyEqual(currentBpm, 120.0));
                bpm.addItem(813, "140 BPM", true, juce::approximatelyEqual(currentBpm, 140.0));
                menu.addSubMenu(juce::String::fromUTF8("BPM xuất MIDI"), bpm);
            }
            menu.addItem(802, juce::String::fromUTF8("Hiện nút kéo MIDI ra..."), true);
            break;
        default:
            return;
    }

    juce::Component::SafePointer<NeuralNoteMainView> safeThis(this);
    menu.showMenuAsync(juce::PopupMenu::Options().withTargetComponent(mWebMenuButtons[static_cast<size_t>(index)].get()),
                       [safeThis](int command) {
                           if (safeThis != nullptr && command != 0)
                               safeThis->_handleWebStyleMenuAction(command);
                       });
}

void NeuralNoteMainView::_handleWebStyleMenuAction(int command)
{
    switch (command) {
        case 101: openAudioFile(); break;
        case 102: case 201: case 402:
            mVisualizationPanel.getToolbar().getClearButton().triggerClick(); break;
        case 202: case 302:
            mTopBar.getBackButton().triggerClick(); break;
        case 301:
            mTopBar.getPlayPauseButton().triggerClick(); break;
        case 303:
            mTopBar.getLoopButton().triggerClick(); break;
        case 401: case 501:
            _setInstrumentMenuOpen(true); break;
        case 601:
            mVisualizationPanel.triggerTranscription(); break;
        case 602:
            mVisualizationPanel.setModelPanelOpen(!mVisualizationPanel.isModelPanelVisible()); break;
        case 603:
            _buildSettingsMenu();
            mSettingsMenu->showMenuAsync(
                juce::PopupMenu::Options().withTargetComponent(mWebMenuButtons[5].get()));
            break;
        case 702:
            mProcessor.getValueTree().setProperty(NnId::ZoomLevelId, 1.0, nullptr);
            mProcessor.getValueTree().setProperty(NnId::VerticalZoomId, -1.0, nullptr);
            break;
        case 801:
            mVisualizationPanel.getToolbar().getExportButton().triggerClick(); break;
        case 811: case 812: case 813:
            mProcessor.getValueTree().setProperty(
                NnId::ExportTempoId, command == 811 ? 90.0 : command == 812 ? 120.0 : 140.0, nullptr);
            break;
        case 304: case 502: case 701: case 802:
            mShowAdvancedControls = !mShowAdvancedControls;
            resized();
            repaint();
            break;
        default: break;
    }
}

void NeuralNoteMainView::_buildSettingsMenu()
{
    mSettingsMenu = std::make_unique<PopupMenu>();
    mSettingsMenuItemsShouldBeTicked.clear();
    mSettingsMenuItemsShouldBeEnabled.clear();

    int item_id = 0;

    // Applies from the next transcription: the model is loaded per run.
    PopupMenu device_menu;
    String device_menu_name = juce::String::fromUTF8("Thiết bị xử lý");

    if (const std::vector<msl::Device>* devices = ComputeDevices::tryGet()) {
        const auto is_selected = [devices](std::optional<std::size_t> inIndex) {
            return ComputeDevices::resolve(*devices, NnGlobalSettings::getComputeDevice()) == inIndex;
        };

        const auto add_device_item =
            [&](const String& inLabel, std::optional<std::size_t> inIndex, const ComputeDeviceChoice& inChoice) {
                auto device_item = PopupMenu::Item(inLabel);
                device_item.setID(++item_id);
                device_item.setEnabled(true);
                mSettingsMenuItemsShouldBeTicked.emplace_back(device_item.itemID,
                                                              [is_selected, inIndex] { return is_selected(inIndex); });
                device_item.setTicked(mSettingsMenuItemsShouldBeTicked.back().second());
                device_item.setAction([this, inChoice] {
                    NnGlobalSettings::setComputeDevice(inChoice);
                    _refreshSettingsMenu();
                });
                device_menu.addItem(device_item);
            };

        const String auto_label = juce::String::fromUTF8("Tự động (") + String(ComputeDevices::label(*devices, msl::autoDevice(*devices))) + ")";
        const auto selected = ComputeDevices::resolve(*devices, NnGlobalSettings::getComputeDevice());
        device_menu_name +=
            ": " + (selected.has_value() ? String(ComputeDevices::label(*devices, *selected)) : auto_label);

        add_device_item(auto_label, std::nullopt, {});
        device_menu.addSeparator();

        for (std::size_t i = 0; i < devices->size(); ++i) {
            add_device_item(ComputeDevices::label(*devices, i), i, ComputeDevices::choiceFor(*devices, i));
        }
    }

    else {
        auto detecting_item = PopupMenu::Item(juce::String::fromUTF8("Đang tìm thiết bị..."));
        detecting_item.setID(++item_id);
        detecting_item.setEnabled(false);
        mSettingsMenuItemsShouldBeEnabled.emplace_back(detecting_item.itemID, [] { return false; });
        device_menu.addItem(detecting_item);
    }

    mSettingsMenu->addSubMenu(device_menu_name, device_menu);
    mSettingsMenu->addSeparator();

    auto tooltip_visibility_item = PopupMenu::Item(juce::String::fromUTF8("Hiện chú thích"));
    tooltip_visibility_item.setID(++item_id);
    tooltip_visibility_item.setEnabled(true);
    mSettingsMenuItemsShouldBeTicked.emplace_back(tooltip_visibility_item.itemID,
                                                  [] { return NnGlobalSettings::getTooltipsVisible(); });
    tooltip_visibility_item.setTicked(mSettingsMenuItemsShouldBeTicked.back().second());
    tooltip_visibility_item.setAction([this] {
        NnGlobalSettings::setTooltipsVisible(!NnGlobalSettings::getTooltipsVisible());
        _updateTooltipVisibility();
        _refreshSettingsMenu();
    });
    mSettingsMenu->addItem(tooltip_visibility_item);

    // The editor applies this factor, clamped to what the display can hold, and writes back the
    // one it used -- so a preset too large for the screen ends up unticked.
    PopupMenu scale_menu;

    for (const double scale: {0.5, 0.75, 1.0, 1.25, 1.5, 2.0}) {
        auto scale_item = PopupMenu::Item(String(roundToInt(scale * 100.0)) + "%");
        scale_item.setID(++item_id);
        scale_item.setEnabled(true);
        mSettingsMenuItemsShouldBeTicked.emplace_back(scale_item.itemID, [this, item_scale = scale] {
            auto* editor = findParentComponentOfClass<NeuralNoteEditor>();
            return editor != nullptr && std::abs(editor->getAppliedScale() - item_scale) < 0.005;
        });
        scale_item.setTicked(mSettingsMenuItemsShouldBeTicked.back().second());
        scale_item.setAction([this, item_scale = scale] {
            // applyScale stores what it settled on, by the same path a resize drag takes.
            if (auto* editor = findParentComponentOfClass<NeuralNoteEditor>()) {
                editor->applyScale(item_scale);
            }

            _refreshSettingsMenu();
        });
        scale_menu.addItem(scale_item);
    }

    mSettingsMenu->addSubMenu(juce::String::fromUTF8("Kích thước cửa sổ"), scale_menu);

    auto reset_zoom_item = PopupMenu::Item(juce::String::fromUTF8("Đặt lại thu phóng Piano Roll"));
    reset_zoom_item.setID(++item_id);
    reset_zoom_item.setTicked(false);
    reset_zoom_item.setAction([this] {
        mProcessor.getValueTree().setProperty(NnId::ZoomLevelId, 1.0, nullptr);

        // Negative returns the vertical zoom to fitting itself to the transcription, which is what
        // it does before the slider is ever touched.
        mProcessor.getValueTree().setProperty(NnId::VerticalZoomId, -1.0, nullptr);
    });
    mSettingsMenu->addItem(reset_zoom_item);
    mSettingsMenu->addSeparator();

    // A dense mix can name more instruments than MIDI has channels; see MidiOverflowMode.
    PopupMenu overflow_menu;

    for (const auto& [mode, label]:
         {std::pair {MidiOverflowMode::ReuseChannels, "Dùng lại các kênh cuối"},
          std::pair {MidiOverflowMode::DropExtraInstruments, "Bỏ nhạc cụ vượt giới hạn"}}) {
        auto overflow_item = PopupMenu::Item(label);
        overflow_item.setID(++item_id);
        overflow_item.setEnabled(true);
        mSettingsMenuItemsShouldBeTicked.emplace_back(overflow_item.itemID, [this, item_mode = mode] {
            return static_cast<int>(mProcessor.getValueTree().getProperty(
                       NnId::MidiOverflowModeId, static_cast<int>(MidiOverflowMode::ReuseChannels)))
                   == static_cast<int>(item_mode);
        });
        overflow_item.setTicked(mSettingsMenuItemsShouldBeTicked.back().second());
        overflow_item.setAction([this, item_mode = mode] {
            mProcessor.getValueTree().setProperty(NnId::MidiOverflowModeId, static_cast<int>(item_mode), nullptr);
            _refreshSettingsMenu();
        });
        overflow_menu.addItem(overflow_item);
    }

    mSettingsMenu->addSubMenu(juce::String::fromUTF8("Xuất MIDI khi hết kênh"), overflow_menu);

#if JUCE_WINDOWS
    mSettingsMenu->addSeparator();

    PopupMenu crash_menu;

    auto crash_reports_item = PopupMenu::Item(juce::String::fromUTF8("Bật báo cáo sự cố"));
    crash_reports_item.setID(++item_id);
    crash_reports_item.setEnabled(true);
    mSettingsMenuItemsShouldBeTicked.emplace_back(crash_reports_item.itemID,
                                                  [] { return SharedResourcePointer<CrashReporter>()->isEnabled(); });
    crash_reports_item.setTicked(mSettingsMenuItemsShouldBeTicked.back().second());
    crash_reports_item.setAction([this] {
        const SharedResourcePointer<CrashReporter> crash_reporter;
        crash_reporter->setEnabled(!crash_reporter->isEnabled());
        _refreshSettingsMenu();
    });
    crash_menu.addItem(crash_reports_item);

    auto open_crash_reports_item = PopupMenu::Item(juce::String::fromUTF8("Mở thư mục báo cáo sự cố"));
    open_crash_reports_item.setID(++item_id);
    open_crash_reports_item.setEnabled(true);
    open_crash_reports_item.setAction([] { NNFileUtils::openDirectory(NNFileUtils::getCrashReportsDirectory()); });
    crash_menu.addItem(open_crash_reports_item);

    mSettingsMenu->addSubMenu(juce::String::fromUTF8("Báo cáo sự cố"), crash_menu);
#endif

    mSettingsMenu->addSeparator();

    PopupMenu logs_menu;
    PopupMenu log_level_menu;

    for (const auto& [level, label]: {std::pair {NnLogger::Level::Debug, "Debug"},
                                      std::pair {NnLogger::Level::Info, "Info"},
                                      std::pair {NnLogger::Level::Warning, "Cảnh báo"},
                                      std::pair {NnLogger::Level::Error, "Lỗi"}}) {
        auto level_item = PopupMenu::Item(label);
        level_item.setID(++item_id);
        level_item.setEnabled(true);
        mSettingsMenuItemsShouldBeTicked.emplace_back(
            level_item.itemID, [item_level = level] { return NnLogger::getLevel() == item_level; });
        level_item.setTicked(mSettingsMenuItemsShouldBeTicked.back().second());
        level_item.setAction([this, item_level = level] {
            NnLogger::setLevel(item_level);
            NnGlobalSettings::setLogLevel(item_level);
            _refreshSettingsMenu();
        });
        log_level_menu.addItem(level_item);
    }

    logs_menu.addSubMenu(juce::String::fromUTF8("Mức ghi nhật ký"), log_level_menu);

    auto open_logs_item = PopupMenu::Item(juce::String::fromUTF8("Mở thư mục nhật ký"));
    open_logs_item.setID(++item_id);
    open_logs_item.setEnabled(true);
    open_logs_item.setAction([] { NNFileUtils::openDirectory(NNFileUtils::getLogsDirectory()); });
    logs_menu.addItem(open_logs_item);

    mSettingsMenu->addSubMenu(juce::String::fromUTF8("Nhật ký"), logs_menu);

    auto check_updates_item = PopupMenu::Item(juce::String::fromUTF8("Kiểm tra cập nhật"));
    check_updates_item.setID(++item_id);
    check_updates_item.setEnabled(true);
    check_updates_item.setTicked(false);
    check_updates_item.setAction([this] { mUpdateCheck->checkForUpdate(true); });
    mSettingsMenu->addSeparator();
    mSettingsMenu->addItem(check_updates_item);
}

void NeuralNoteMainView::_refreshSettingsMenu()
{
    // An item with no predicate of its own falls back to inDefault: unticked, and enabled.
    const auto evaluate =
        [](const std::vector<std::pair<int, std::function<bool()>>>& inPredicates, int inItemId, bool inDefault) {
            for (const auto& [item_id, predicate]: inPredicates) {
                if (item_id == inItemId && predicate != nullptr) {
                    return predicate();
                }
            }

            return inDefault;
        };

    for (PopupMenu::MenuItemIterator iterator(*mSettingsMenu, true); iterator.next();) {
        auto& item = iterator.getItem();
        item.setTicked(evaluate(mSettingsMenuItemsShouldBeTicked, item.itemID, false));
        item.setEnabled(evaluate(mSettingsMenuItemsShouldBeEnabled, item.itemID, true));
    }
}

void NeuralNoteMainView::_updateTooltipVisibility()
{
    if (NnGlobalSettings::getTooltipsVisible()) {
        if (mTooltipWindow == nullptr) {
            mTooltipWindow = std::make_unique<TooltipWindow>(this, 800);
            mTooltipWindow->setOpaque(false);
        }
    } else {
        mTooltipWindow = nullptr;
    }
}
