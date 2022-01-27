export function makePrefixedObj(obj: Object, prefix?: string): Object {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
        result[`${prefix}${key}`] = value;
    }
    return result;
}