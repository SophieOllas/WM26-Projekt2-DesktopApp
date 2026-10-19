const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('exposed', {
  login: (credentials) => ipcRenderer.invoke('auth:login', credentials),
  reconnect: () => ipcRenderer.invoke('auth:reconnect'),
  sendMessage: (message) => ipcRenderer.invoke('chat:send', message),

  onStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('chat:status', listener);
    return () => ipcRenderer.removeListener('chat:status', listener);
  },

  onError: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('auth:error', listener);
    return () => ipcRenderer.removeListener('auth:error', listener);
  },

  onMessage: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('chat:message', listener);
    return () => ipcRenderer.removeListener('chat:message', listener);
  }
});