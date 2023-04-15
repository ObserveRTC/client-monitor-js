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
export const EMPTY_ITERATOR: Iterable<any> = new class implements Iterable<any> {
    /*eslint-disable @typescript-eslint/no-explicit-any */
    [Symbol.iterator](): Iterator<any, any, undefined> {
        return {
            next: () => {
                return {
                    done: true,
                    value: null,
                }
            }
        }
    }
}


export function createEmptyIterator<T>(value: T): Iterator<T, T, undefined> {
    const result = new class implements Iterator<T, T, undefined> {
        next() {
            return {
                done: true,
                value,
            }
        }
    }
    return result;
}

export function wrapValueWithIterator<T>(value: T): Iterator<T, T, undefined> {
    let invoked = false;
    const result = new class implements Iterator<T, T, undefined> {
        next() {
            if (!invoked) {
                invoked = true;
                return {
                    done: false,
                    value,
                };
            }
            return {
                done: true,
                value,
            };
        }
    }
    return result;
}

export function wrapValueWithIterable<T>(value: T): Iterable<T> {
    const result = new class implements Iterable<T> {
        [Symbol.iterator](): Iterator<T, any, undefined> {
            return wrapValueWithIterator(value);
        }
    }
    return result;
}


export function createEmptyIterable<T>(value: T): Iterable<T> {
    const result = new class implements Iterable<T> {
        [Symbol.iterator](): Iterator<T, any, undefined> {
            return createEmptyIterator(value);
        }
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
