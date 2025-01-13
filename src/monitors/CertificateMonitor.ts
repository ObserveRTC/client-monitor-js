import { CertificateStats } from "../schema/ClientSample";

export class CertificateMonitor implements CertificateStats {
	private _visited = true;

	timestamp: number;
	id: string;
	fingerprint?: string | undefined;
	fingerprintAlgorithm?: string | undefined;
	base64Certificate?: string | undefined;
	issuerCertificateId?: string | undefined;
	appData?: Record<string, unknown> | undefined;

	public constructor(
		options: CertificateStats,
	) {
		this.id = options.id;
		this.timestamp = options.timestamp;
	}

	public get visited(): boolean {
		const result = this._visited;

		this._visited = false;

		return result;
	}

	public accept(stats: Omit<CertificateStats, 'appData'>): void {
		this._visited = true;

		const elapsedInMs = stats.timestamp - this.timestamp;
		if (elapsedInMs <= 0) {
			return; // logger?
		}

		Object.assign(this, stats);
	}

	public createSample(): CertificateStats {
		return {
			id: this.id,
			timestamp: this.timestamp,
			fingerprint: this.fingerprint,
			fingerprintAlgorithm: this.fingerprintAlgorithm,
			base64Certificate: this.base64Certificate,
			issuerCertificateId: this.issuerCertificateId,
			appData: this.appData,
		};
	}
}