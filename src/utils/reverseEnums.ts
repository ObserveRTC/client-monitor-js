// Source: https://www.examplefiles.net/cs/230820
// Big love and thanks for the creator avoiding me to spend hours
// figuring out the right way of types to use.
/*eslint-disable @typescript-eslint/no-explicit-any*/
type Entries<T extends object> = { [K in keyof T]: [K, T[K]] }[keyof T];

function reverseEnum<E extends Record<keyof E, string | number>>(
    e: E
): { [K in E[keyof E]]: Extract<Entries<E>, [any, K]>[0] };
function reverseEnum(e: Record<string | number, string | number>): Record<string | number, string | number> {
    const ret: Record<string | number, string | number> = {};
    Object.keys(e).forEach((k) => (ret[e[k]] = k));
    return ret;
}

export function twoWayEnum<E extends Record<keyof E, string | number>>(e: E) {
    return Object.assign(reverseEnum(e), e);
}
