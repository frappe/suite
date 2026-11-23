import type { Producer } from 'mediasoup-client/types'

import {
  parseCameraLayerDemand,
  type CameraLayerDemand,
} from '../../../../../../suite/meet/types/cameraLayers'
import type { SFUClient } from '../SFUClient'

interface Publication {
  producer: Producer
  version: number
  desired: number
  applied: number
  pending: boolean
}

/** Serialize sender changes and recover demand missed during publish/reconnect. */
export class CameraLayerController {
  private publications = new Map<string, Publication>()
  private client: SFUClient | null = null
  private receive = (value: unknown) => {
    const demand = parseCameraLayerDemand(value)
    if (demand) this.apply(demand)
  }
  private refresh = () => {
    for (const state of this.publications.values()) this.fetchDemand(state)
  }

  initialize(client: SFUClient): void {
    this.cleanup()
    this.client = client
    client.on('producer:camera_layers', this.receive)
    client.on('reconnect', this.refresh)
  }

  addProducer(producer: Producer): void {
    const count = producer.rtpParameters?.encodings?.length ?? 0
    if (
      producer.closed ||
      producer.kind !== 'video' ||
      producer.appData?.type === 'screen' ||
      count < 2
    )
      return
    const state: Publication = {
      producer,
      version: 0,
      desired: count - 1,
      applied: count - 1,
      pending: false,
    }
    this.publications.set(producer.id, state)
    producer.observer.once('close', () => {
      this.publications.delete(producer.id)
    })
    // A demand event can precede the local Producer returned by produce().
    this.fetchDemand(state)
  }

  cleanup(): void {
    this.client?.off('producer:camera_layers', this.receive)
    this.client?.off('reconnect', this.refresh)
    this.client = null
    this.publications.clear()
  }

  private fetchDemand(state: Publication): void {
    const client = this.client
    if (!client) return
    void client
      .getCameraLayerDemand(state.producer.id)
      .then((demand) => {
        if (client === this.client && this.publications.get(state.producer.id) === state && demand)
          this.apply(demand)
      })
      .catch(() => {
        // Older servers do not implement this optional optimisation. Keep quality.
      })
  }

  private apply(demand: CameraLayerDemand): void {
    const state = this.publications.get(demand.producerId)
    if (
      !state ||
      state.producer.closed ||
      demand.version <= state.version ||
      demand.maxSpatialLayer >= (state.producer.rtpParameters.encodings?.length ?? 0)
    )
      return
    state.version = demand.version
    state.desired = demand.maxSpatialLayer
    void this.drain(state)
  }

  private async drain(state: Publication): Promise<void> {
    if (state.pending) return
    state.pending = true
    try {
      while (
        this.publications.get(state.producer.id) === state &&
        !state.producer.closed &&
        state.applied !== state.desired
      ) {
        const layer = state.desired
        await this.setLayer(state.producer, layer)
        state.applied = layer
      }
    } catch (error) {
      if (this.publications.get(state.producer.id) !== state || state.producer.closed) return
      // This is optional work reduction. Prefer full quality over a retry loop.
      this.publications.delete(state.producer.id)
      console.warn('Disabling camera layer control; restoring full quality', error)
      try {
        const maximum = (state.producer.rtpParameters.encodings?.length ?? 1) - 1
        await this.setLayer(state.producer, maximum)
      } catch (restoreError) {
        console.warn('Failed to restore camera quality', restoreError)
      }
    } finally {
      state.pending = false
    }
  }
  private async setLayer(producer: Producer, layer: number): Promise<void> {
    const encodings = () => producer.rtpSender?.getParameters().encodings
    const matches = () =>
      encodings()?.every((encoding, index) => (encoding.active !== false) === index <= layer)
    // This mediasoup-client version swallows some handler errors and still
    // caches maxSpatialLayer. Inspect the sender, and break that cached no-op
    // before restoring a layer limit that did not actually reach the browser.
    if (producer.maxSpatialLayer === layer && matches() === false) {
      const maximum = (producer.rtpParameters.encodings?.length ?? 1) - 1
      await producer.setMaxSpatialLayer(layer === maximum ? 0 : maximum)
    }
    await producer.setMaxSpatialLayer(layer)
    if (matches() === false) throw new Error('Camera sender did not apply its requested layers')
  }
}
