/**
 * Formula evaluation for table cells.
 * Supports basic arithmetic: +, -, *, /, parentheses, operator precedence.
 */

/**
 * Evaluate a formula string that starts with '='.
 * Returns the numeric result, or null if the expression is invalid or unsupported.
 */
export function evaluateFormula(formula: string): number | null {
	const expr = formula.substring(1).trim();
	if (!/^[\d+\-*/().\s]+$/.test(expr)) return null;
	try {
		return parseArithmetic(expr);
	} catch {
		return null;
	}
}

function parseArithmetic(expr: string): number {
	const tokens = expr.replace(/\s+/g, '').match(/\d+(?:\.\d+)?|[()+\-*/]/g) ?? [];
	let index = 0;

	const parseFactor = (): number => {
		const token = tokens[index++];
		if (token === '(') {
			const value = parseSum();
			if (tokens[index++] !== ')') throw new Error('Unbalanced parentheses');
			return value;
		}
		if (token === '-') return -parseFactor();
		const num = Number(token);
		if (!Number.isFinite(num)) throw new Error(`Invalid token: ${String(token)}`);
		return num;
	};

	const parseProduct = (): number => {
		let value = parseFactor();
		while (tokens[index] === '*' || tokens[index] === '/') {
			const op = tokens[index++];
			const right = parseFactor();
			value = op === '*' ? value * right : value / right;
		}
		return value;
	};

	const parseSum = (): number => {
		let value = parseProduct();
		while (tokens[index] === '+' || tokens[index] === '-') {
			const op = tokens[index++];
			const right = parseProduct();
			value = op === '+' ? value + right : value - right;
		}
		return value;
	};

	const result = parseSum();
	if (index !== tokens.length || !Number.isFinite(result)) {
		throw new Error('Invalid expression');
	}
	return result;
}
