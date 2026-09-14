/**
 * Preload bridge for the History window.
 */

import { contextBridge, ipcRenderer } from "electron";
import { IpcChannels } from "../shared/ipcChannels";
import type { SessionSummary, StoredSession } from "../shared/types";

contextBridge.exposeInMainWorld("huddleHistory", {
  requestSessions: (): Promise<SessionSummary[]> =>
    ipcRenderer.invoke(IpcChannels.historyRequestSessions),

  requestSessionDetail: (sessionId: string): Promise<StoredSession | null> =>
    ipcRenderer.invoke(IpcChannels.historyRequestSessionDetail, sessionId),

  deleteSession: (sessionId: string): void => {
    ipcRenderer.send(IpcChannels.historyDeleteSession, sessionId);
  },

  deleteAllSessions: (): void => {
    ipcRenderer.send(IpcChannels.historyDeleteAllSessions);
  },

  requestClose: (): void => {
    ipcRenderer.send(IpcChannels.historyRequestClose);
  },
});
