
export interface Mapper<TIn, TOut> {
    map(entry: TIn): TOut | undefined;
}