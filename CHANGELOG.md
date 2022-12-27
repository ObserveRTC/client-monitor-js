## 1.3.1
 * Change visibility of MediasoupStatsCollector `addTransport` method to be public
 * make imported schema version to be 2.2.0 instead of the last snapshot

## 1.3.0
 * Change the concept of add and removing stats collectors responsible from the clientMonitor to the Collectors
 * Make warn log instead of throwing exception In case a provided callId is invalid 
 * Make callId to be set only once per session
 * Add mediasoup integration
 * Add setter for clientId, and roomId
 * Move addStatsCollector to a new objects called Collectors
 * Add MediasoupStatsCollector, PeerConnectionStatsCollector
 * bugfix timer
 * add event dispatched when client is connected to an observer
 * Add rawstats emitted for onStatsSamples event
 * Add last stats change timestamp to metrics
 * Add Mediasoup hack for trackIdentifier for firefox

## 1.2.0
 * Make timer tick based instead of calculated next delays
 * Be able to collect samples if sender is not available
 * add maxSamples config option to accumulator

## 1.1.0
 * Fix continous media source meta sending due to constantly changing `audioLevel`
 * add ice-candidate-pairs according to schema changes in 2.1.0^
 * align peer-connection-transport changes according to schema changes in 2.1.0^
 * make id navigational alterations in PeerConnectionImpl related to the webrtc schema changes
 * run prettier

## 1.0.1

 * Add validation for extension stats to check if the given payload is a valid json string or not.

## 1.0.0

Init
