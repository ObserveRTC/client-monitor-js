/*eslint-disable @typescript-eslint/ban-types*/
/*eslint-disable @typescript-eslint/no-explicit-any*/
export function makePrefixedObj(obj: any, prefix?: string, camelCase?: boolean): Object {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
        const newKey = camelCase ? key.charAt(0).toUpperCase() + key.slice(1) : key;
        result[`${prefix}${newKey}`] = value;
    }
    return result;
}

/*eslint-disable @typescript-eslint/no-explicit-any */
export function makeForwardDeltaObj(left: any, right: any): any {
    if (left === undefined || right === undefined) {
        if (left === undefined && right === undefined) return undefined;
        if (left === undefined) return right;
        return undefined;
    }
    if (left === null || right === null) {
        if (left === null && right === null) return undefined;
        if (left === null) return right;
        return undefined;
    }
    const type = typeof left;
    if (type !== typeof right) {
        throw new Error(`Cannot make a delta obj between different type of object (${type}, ${typeof right}), sorry!`);
    }
    if (type === "function") {
        throw new Error(`Cannot make a delta obj on functions?!`);
    }
    if (Array.isArray(left) || Array.isArray(right)) {
        throw new Error(`Cannot make a delta obj between arrays, sorry!`);
    }
    if (type === "object") {
        /*eslint-disable @typescript-eslint/no-explicit-any */
        const result: any = {};
        for (const keyA of Object.keys(left)) {
            const deltaValue = makeForwardDeltaObj(left[keyA], right[keyA]);
            if (deltaValue === undefined) continue;
            result[keyA] = deltaValue;
        }
        for (const keyB of Object.keys(right)) {
            if (result[keyB] !== undefined) continue;
            const deltaValue = makeForwardDeltaObj(left[keyB], right[keyB]);
            if (deltaValue === undefined) continue;
            result[keyB] = deltaValue;
        }
        return result;
    }
    if (left === right) return undefined;
    return right;
}

export const NULL_UUID = "00000000-0000-0000-0000-000000000000";
