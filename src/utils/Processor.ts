export type Middleware<T> = (input: T, next: (input: T) => void) => void;

export function createProcessor<T>() {
	const middlewares: Middleware<T>[] = [];
	function addMiddleware(middleware: Middleware<T>) {
		middlewares.push(middleware);
	}
	function removeMiddleware(middleware: Middleware<T>) {
		const index = middlewares.indexOf(middleware);
		if (index < 0) return;
		middlewares.splice(index, 1);
	}
	function process(input: T, onprocessed?: (err?: string) => void) {
		const createNext = (index: number): ((data: T) => void) => {
			const middleware = middlewares[index];
			if (!middleware) {
				return () => onprocessed?.();
			}
			return (givenInput: T) => {
				try {
					middleware(givenInput, createNext(index + 1));
				} catch (error) {
					onprocessed?.(`${error}`);
				}
				
			}
		}
		return createNext(0)(input);
	}

	return {
		addMiddleware,
		removeMiddleware,
		process,
	}
	
}