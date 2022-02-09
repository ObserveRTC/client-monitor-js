import { sha256 } from 'js-sha256';

/*eslint-disable @typescript-eslint/no-explicit-any */
export function hash(obj: any): string {
    const digester = sha256.create();
    if (obj === undefined) {
        digester.update("undefined");
        return digester.hex();
    }
    if (obj === null) {
        digester.update("undefined");
        return digester.hex();
    }
    const type = typeof obj;
    if (type === "function") {
        digester.update("function");
        return digester.hex();
    }
    if (type === "object") {
        for (const [key, value] of Object.entries(obj)) {
            const valueHash = hash(value);
            digester.update(key + valueHash);
        }
        return digester.hex();
    }
    switch (type) {
        case "bigint":
            digester.update((obj as bigint).toString());
            break;
        case "boolean":
            digester.update((obj as boolean).toString());
            break;
        case "number":
            digester.update((obj as number).toString());
            break;
        case "string":
            digester.update(obj as string);
            break;
        case "undefined":
            digester.update("undefined");
            break;
        case "symbol":
            digester.update((obj as symbol).toString())
            break;
    }
    return digester.hex();
}