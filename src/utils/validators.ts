

export function isValidUuid(str: string): boolean {
    const regexp = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return regexp.test(str);
}

export function checkUuid(str: string, context?: string): void {
    if (!isValidUuid(str)) {
        throw new Error(`Invalid Uuid ${str}. Context: ${context}`);
    }
}