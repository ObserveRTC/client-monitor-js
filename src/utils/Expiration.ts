export class Expiration implements Promise<void>{
    private _reject: (err: any) => void = () => {};
    private _timer?: ReturnType<typeof setTimeout>;
    private _promise: Promise<void>;
    constructor(timeoutInMs: number) {
        this._promise = new Promise((resolve, reject) => {
            this._timer = setTimeout(() => {
                this._timer = undefined;
                resolve();
            }, timeoutInMs);
            this._reject = reject;
        });
    }

    public cancel(err: any): void {
        if (this._timer) {
            clearTimeout(this._timer);
            this._reject(err);
        }
        throw new Error(`Promise is already resolved`);
    }

    public then<TResult1 = void, TResult2 = never>(onfulfilled?: (value: void) => TResult1 | PromiseLike<TResult1>, onrejected?: (reason: any) => TResult2 | PromiseLike<TResult2>): Promise<TResult1 | TResult2> {
        return this._promise.then(onfulfilled, onrejected);
    }
    public catch<TResult = never>(onrejected?: (reason: any) => TResult | PromiseLike<TResult>): Promise<void | TResult> {
        return this._promise.catch(onrejected);
    }
    get [Symbol.toStringTag](): string {
        return this._promise.toString();
    }
    public finally(onfinally?: () => void): Promise<void> {
        return this._promise.finally(onfinally);
    }
}