/*eslint-disable @typescript-eslint/ban-types*/
/*eslint-disable @typescript-eslint/no-explicit-any*/
export function makePrefixedObj(obj: any, prefix?: string): Object {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
        result[`${prefix}${key}`] = value;
    }
    return result;
}