export interface TrafficLightPositionPayload {
  x: number;
  y: number;
}

export const windowBridge = {
  setTrafficLightPosition(payload: TrafficLightPositionPayload): Promise<{ ok: boolean }> {
    return window.electronAPI.windowControls.setTrafficLightPosition(payload);
  }
};
