#ifndef ReleaseDir
#define ReleaseDir "cmake-build-release/NeuralNote_artefacts/Release"
#endif

[Setup]
; NOTIQ uses a distinct AppId to avoid overwriting any upstream NOTIQ installation.
AppId={{D9C4D7EC-4269-4500-A8B0-7B58AC8329BF}
AppName=NOTIQ
AppVersion=0.1.0
OutputBaseFilename=NOTIQ_Installer_Windows_x64
DefaultDirName={commonpf}\NOTIQ
DisableProgramGroupPage=yes
InfoBeforeFile=..\readme.txt
LicenseFile=..\license.txt
AppPublisher=LUNOR MUSIC
AppPublisherURL=https://github.com/Gamevalentine/NeuralNote
AppSupportURL=https://github.com/Gamevalentine/NeuralNote
AppUpdatesURL=https://github.com/Gamevalentine/NeuralNote
AlwaysShowComponentsList=yes
Compression=lzma
SolidCompression=yes
DisableDirPage=yes
SetupIconFile=..\..\NeuralNote\Assets\Logo\NeuralNote.ico
UninstallDisplayIcon={app}\NOTIQ.exe
AppCopyright=Copyright (c) 2026 Damien Ronssin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Types]
Name: "custom"; Description: "Custom Installation"; Flags: iscustom

[Components]
Name: "mainapp"; Description: "NOTIQ Standalone"; Types: custom; Flags: disablenouninstallwarning
Name: "plugin"; Description: "NOTIQ VST3"; Types: custom; Flags: disablenouninstallwarning

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Components: mainapp; Flags: unchecked

; Do not delete any existing NeuralNote installation or user data.

[Files]
Source: "..\..\{#ReleaseDir}\Standalone\NOTIQ.exe"; DestDir: "{app}"; Components:mainapp; Flags: ignoreversion recursesubdirs;
Source: "..\..\{#ReleaseDir}\VST3\NOTIQ.vst3\*"; DestDir: "{commoncf}\VST3\NOTIQ.vst3"; Components:plugin; Flags: ignoreversion recursesubdirs;

[Icons]
Name: "{autoprograms}\NOTIQ"; Filename: "{app}\NOTIQ.exe"; Components: mainapp
Name: "{autodesktop}\NOTIQ"; Filename: "{app}\NOTIQ.exe"; Tasks: desktopicon

[Code]
// Models, recordings and settings live in the user's profile, not in {app}. Only the profile
// of the user running the uninstaller is cleaned, and a silent uninstall keeps the data.
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
begin
  if CurUninstallStep <> usPostUninstall then
    Exit;

  DelTree(AddBackslash(GetTempDir) + 'notiq', True, True, True);

  DataDir := ExpandConstant('{userappdata}\NOTIQ');
  if DirExists(DataDir) and not UninstallSilent then
    if MsgBox('Also delete NOTIQ''s downloaded models, recordings and settings?' + #13#10#13#10 + DataDir,
              mbConfirmation, MB_YESNO) = IDYES then
      DelTree(DataDir, True, True, True);
end;
