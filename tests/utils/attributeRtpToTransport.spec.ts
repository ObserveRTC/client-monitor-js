import { attributeRtpToTransport } from "../../src/utils/common";

describe('attributeRtpToTransport', () => {
    const rtp = (transportId?: string) => ({ transportId });

    it('attributes by exact transportId match', () => {
        const streams = [ rtp('T1'), rtp('T2'), rtp('T1') ];

        expect(attributeRtpToTransport(streams, 'T1', 2)).toHaveLength(2);
        expect(attributeRtpToTransport(streams, 'T2', 2)).toHaveLength(1);
    });

    it('attributes transportId-less streams to a sole transport (exact under BUNDLE)', () => {
        const streams = [ rtp(undefined), rtp(undefined) ];

        expect(attributeRtpToTransport(streams, 'T1', 1)).toHaveLength(2);
    });

    it('never attributes transportId-less streams when several transports exist', () => {
        // this is the double-counting case the shared rule exists to prevent:
        // the same unattributed stream must not be counted against both transports
        const streams = [ rtp(undefined) ];

        expect(attributeRtpToTransport(streams, 'T1', 2)).toHaveLength(0);
        expect(attributeRtpToTransport(streams, 'T2', 2)).toHaveLength(0);
    });

    it('prefers exact matches over the sole-transport fallback', () => {
        const streams = [ rtp('T1'), rtp(undefined) ];

        const attributed = attributeRtpToTransport(streams, 'T1', 1);

        expect(attributed).toHaveLength(1);
        expect(attributed[0].transportId).toBe('T1');
    });

    it('returns nothing for a transport no stream names when exact matches exist elsewhere', () => {
        const streams = [ rtp('T1') ];

        expect(attributeRtpToTransport(streams, 'T2', 2)).toHaveLength(0);
    });
});
