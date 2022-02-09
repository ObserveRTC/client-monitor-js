import { TransportState } from '../../src/transports/Transport';
import { WebsocketTransport, WebsocketTransportConfig } from "../../src/transports/WebsocketTransport";

describe("WebsocketTransport", () => {
    describe("Given a server listening for connection", () => {
        const url = 'ws://localhost:7070';
        const config: WebsocketTransportConfig = {
            url,
        };
        // let buffer: string[] = [];
        // server.on("connection", ws => {
        //     console.log("connection");
        //     ws.on("message", data => {
        //         const message = new TextDecoder().decode(data as ArrayBuffer);
        //         buffer.push(message);
        //    });
        // });
        const transport = WebsocketTransport.create(config);
        describe("When transport is created", () => {
            it("Then state is created", () => {
                expect(transport.state).toBe(TransportState.Created);
            });
        });
        // describe("When transport connect() method is called", () => {
        //     it("Then state is connected", async () => {
        //         await transport.connect();
        //         expect(transport.state).toBe(TransportState.Connected);
        //     });
        // });
        // describe("When transport send() methods is called", () => {
        //     it("Then message can be received", async () => {
        //         const message = new TextEncoder().encode("message");
        //         await transport.send(message);
        //         await expect(server).toReceiveMessage("message");
        //         expect(buffer[0]).toBe(message);
        //         buffer = [];
        //     });
        // });
    });
    // server.close();
});