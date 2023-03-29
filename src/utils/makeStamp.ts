/*eslint-disable @typescript-eslint/no-explicit-any */
export function makeStamp(obj: any): string {
    // const digester = sha256.create();
    if (obj === undefined) {
        // digester.update("undefined");
        return '0';
    }
    if (obj === null) {
        // digester.update("undefined");
        return '1';
    }
    const type = typeof obj;
    if (type === "function") {
        // digester.update("function");
        return '2';
    }

    if (type === "object") {
        const stringbuffer: string[] = [];
        for (const [key, value] of Object.entries(obj)) {
            stringbuffer.push(makeStamp(key));
            stringbuffer.push(makeStamp(value));
        }
        let result = stringbuffer.join('');
        while (256 < result.length) {
            const charcodes: number[] = [];
            for (let i = 0; i < result.length; i += 2) {
                const charCode = result.charCodeAt(i) ^ result.charCodeAt(i + 1);
                charcodes.push(charCode);
            }
            result = String.fromCharCode(...charcodes);
        }
        return result;
    }
    return `${obj}`;
}