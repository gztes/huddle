/**
 * Preload bridge for the Settings window.
 */

import { contextBridge, ipcRenderer } from "electron";
import { IpcChannels } from "../shared/ipcChannels";
import type { SettingsState } from "../shared/types";

contextBridge.exposeInMainWorld("huddleSettings", {
  requestState: (): Promise<SettingsState> => ipcRenderer.invoke(IpcChannels.settingsRequestState),

  save: (update: SettingsState): void => {
    ipcRenderer.send(IpcChannels.settingsSave, update);
  },

  requestClose: (): void => {
    ipcRenderer.send(IpcChannels.settingsRequestClose);
  },

  onSaved: (handleSaved: () => void): void => {
    ipcRenderer.on(IpcChannels.settingsSaved, () => handleSaved());
  },

  onSaveFailed: (handleSaveFailed: (errorMessage: string) => void): void => {
    ipcRenderer.on(IpcChannels.settingsSaveFailed, (_event, errorMessage: string) => {
      handleSaveFailed(errorMessage);
    });
  },
});
