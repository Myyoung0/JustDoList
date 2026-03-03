const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mailBridge', {
  getConfig: () => ipcRenderer.invoke('mail:get-config'),
  saveConfig: (config) => ipcRenderer.invoke('mail:save-config', config),
  fetchUnread: () => ipcRenderer.invoke('mail:fetch-unread'),
  markRead: (payload) => ipcRenderer.invoke('mail:mark-read', payload),
  notify: (payload) => ipcRenderer.invoke('mail:notify', payload)
});

contextBridge.exposeInMainWorld('gcalBridge', {
  getConfig: () => ipcRenderer.invoke('gcal:get-config'),
  saveConfig: (config) => ipcRenderer.invoke('gcal:save-config', config),
  connect: () => ipcRenderer.invoke('gcal:connect'),
  disconnect: () => ipcRenderer.invoke('gcal:disconnect'),
  syncPush: (payload) => ipcRenderer.invoke('gcal:sync-push', payload),
  syncPull: () => ipcRenderer.invoke('gcal:sync-pull'),
  deleteEvent: (payload) => ipcRenderer.invoke('gcal:delete-event', payload)
});

contextBridge.exposeInMainWorld('usageBridge', {
  getActiveApp: () => ipcRenderer.invoke('usage:get-active-app')
});

contextBridge.exposeInMainWorld('overlayBridge', {
  show: () => ipcRenderer.invoke('overlay:show'),
  hide: () => ipcRenderer.invoke('overlay:hide'),
  toggle: () => ipcRenderer.invoke('overlay:toggle'),
  resize: (payload) => ipcRenderer.invoke('overlay:resize', payload),
  getState: () => ipcRenderer.invoke('overlay:get-state')
});
