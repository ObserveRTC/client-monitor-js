import { WebsocketTransport, WebsocketTransportConfig } from "../../src/transports/WebsocketTransport";

describe("WebsocketTransport", () => {
    describe("Given a server listening for connection", () => {
        const urls = ['ws://localhost:7080'];
        const config: WebsocketTransportConfig = {
            urls,
        };
        const transport = WebsocketTransport.create(config);
        describe("When transport is created", () => {
            it("Then connected is false", () => {
                expect(transport.connected).toBe(false);
            });
        });
    });
});