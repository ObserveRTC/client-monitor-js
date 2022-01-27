
/**
 * A compound message object from the observer to the observed client
 * holds control flags and attachments.
 */
export interface Feedback {
    /**
     * Indicate the client to flush all messages currently it holds and then close the connection
     */
    flushAndClose?: boolean;
}