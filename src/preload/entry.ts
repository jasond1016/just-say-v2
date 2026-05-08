import { contextBridge, ipcRenderer } from 'electron'
import { installPreloadBridge } from './index'

installPreloadBridge(contextBridge, ipcRenderer)
