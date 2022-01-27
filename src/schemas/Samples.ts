// @revision: 1

import { ClientSample } from "./ClientSample";
import { SfuSample } from "./SfuSample";

export interface SamplesMeta {
    clientSampleRevision?: number;
    sfuSampleRevision?: number;
}

export interface ControlFlags {
    /**
     * Indicate that the server should close the connection
    */
    close?: boolean;
}
/**
 * A compound message object from the observed client to the observer
 * holds various samples, control flags and attachments.
 */
export interface Samples {
    /**
     * Additional meta information about the carried payloads
     */
    meta?: SamplesMeta;
    /**
     * array of client samples
     */
    clientSamples?: ClientSample[];

    /**
     * array of sfu samples
     */
    sfuSamples?: SfuSample[];

    /**
     * Additional control flags indicate various operation has to be performed
     */
    controlFlags?: ControlFlags;
}