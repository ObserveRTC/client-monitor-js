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

export function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

export const NULL_UUID = "00000000-0000-0000-0000-000000000000";

