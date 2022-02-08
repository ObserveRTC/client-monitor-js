import * as crypto from "crypto";

/*eslint-disable @typescript-eslint/no-explicit-any */
export function hash(obj: any): string {
    const digester = crypto.createHash("sha256");
    if (obj === undefined) {
        digester.update("undefined");
        return digester.digest("hex");
    }
    if (obj === null) {
        digester.update("undefined");
        return digester.digest("hex");
    }
    const type = typeof obj;
    if (type === "function") {
        digester.update("function");
        return digester.digest("hex");
    }
    if (type === "object") {
        for (const [key, value] of Object.entries(obj)) {
            const valueHash = hash(value);
            digester.update(key + valueHash);
        }
        return digester.digest("hex");
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
    return digester.digest("hex");
}