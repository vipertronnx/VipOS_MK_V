/** Serializable connection state exposed by the OBS service. */
export interface ObsStatus {
  connected: boolean
  currentScene: string | null
  enabled: boolean
  identified: boolean
  lastError: string | null
}

/** An OBS input available to the control surface. */
export interface ObsDiscoveryInput {
  kind: string
  name: string
}

/** A source listed within an OBS scene. */
export interface ObsDiscoverySource {
  enabled: boolean
  id: number
  name: string
  type: string
}

/** A discovered scene, including an error when its source lookup failed. */
export interface ObsDiscoveryScene {
  error?: string
  name: string
  sources: ObsDiscoverySource[]
}

/** Scene and input data used to populate OBS controls. */
export interface ObsDiscovery {
  currentScene: string | null
  inputs: ObsDiscoveryInput[]
  mediaInputs: ObsDiscoveryInput[]
  scenes: ObsDiscoveryScene[]
}

/** Public API returned by the OBS service factory. */
export interface ObsService {
  call(requestType: string, requestData?: object): Promise<unknown>
  connect(): Promise<void>
  disconnect(): Promise<void>
  getCurrentScene(): Promise<string>
  getDiscovery(): Promise<ObsDiscovery>
  getStatus(): ObsStatus
  mediaAction(inputName: string, action: string): Promise<void>
  setInputMute(inputName: string, inputMuted: boolean): Promise<void>
  setSourceVisibility(sceneName: string | undefined, sourceName: string, sceneItemEnabled: boolean): Promise<void>
  switchScene(sceneName: string): Promise<void>
  toggleInputMute(inputName: string): Promise<boolean>
  toggleSourceVisibility(sceneName: string | undefined, sourceName: string): Promise<boolean>
}
