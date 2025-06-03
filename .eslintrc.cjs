module.exports = {
    "env": {
        "browser": true,
        "es2021": true
    },
    "extends": [
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended"
    ],
    "parser": "@typescript-eslint/parser",
    "parserOptions": {
        "ecmaVersion": "latest",
        "sourceType": "module"
    },
    "plugins": [
        "@typescript-eslint"
    ],
    "ignorePatterns": ["*.txt"],
    "rules": {
        "prefer-for-of": 0,
        "no-inferrable-types": 0,
        "no-explicit-any": 0,
        "ban-types": 0,
        "no-this-alias": 0,
        "no-non-null-assertion": 0,
    }
}
