import * as mediasoup from 'mediasoup-client';
import { Sources } from './Sources';

export class MediasoupDeviceBinding {
    public constructor(
        public readonly device: mediasoup.types.Device,
        public readonly sources: Sources
    ) {
        this._transportAdded = this._transportAdded.bind(this);
        this.bind = this.bind.bind(this);
        this.unbind = this.unbind.bind(this);
    }

    public bind() {
        this.device.observer.on('newtransport', this._transportAdded);
    }

    public unbind() {
        this.device.observer.off('newtransport', this._transportAdded);
    }

    private _transportAdded(transport: mediasoup.types.Transport) {
        this.sources.addMediasoupTransport(transport);
    }
}