import { describe, expect, it } from 'vitest';

import {
    collectionOf,
    nameFromCodeSyntax,
    nameFromPath,
    parseTokensFile,
    resolveValues,
    type FigmaToken,
} from '../parse';

describe('nameFromCodeSyntax', () => {
    it('takes the custom property out of a var() call', () => {
        expect(nameFromCodeSyntax('var(--ref-color-grey-100)')).toBe('--ref-color-grey-100');
    });

    it('tolerates the whitespace Figma sometimes stores', () => {
        expect(nameFromCodeSyntax('  var( --sys-color-text-default )  ')).toBe(
            '--sys-color-text-default',
        );
    });

    /*
       The real reason this function exists. One Reference token's WEB syntax is a
       commented-out `TO ADD` placeholder someone typed into the field; accepting it would
       have created a token named after a CSS comment.
    */
    it('refuses a commented-out placeholder rather than naming a token after it', () => {
        expect(nameFromCodeSyntax('*/ TO ADD var(--ref-color-bluesky-100) */')).toBeNull();
    });

    it('refuses anything that is not exactly one var() call', () => {
        expect(nameFromCodeSyntax('var(--a) var(--b)')).toBeNull();
        expect(nameFromCodeSyntax('--ref-color-white')).toBeNull();
        expect(nameFromCodeSyntax('Averta')).toBeNull();
        expect(nameFromCodeSyntax(undefined)).toBeNull();
        expect(nameFromCodeSyntax(42)).toBeNull();
    });
});

describe('nameFromPath', () => {
    it('drops a group the leaf already repeats', () => {
        // Figma's group `Border Radius` holds `border-radius-sm`; joining both would give
        // `--ref-border-radius-border-radius-sm`.
        expect(nameFromPath('reference', ['Border Radius', 'border-radius-sm'])).toBe(
            '--ref-border-radius-sm',
        );
    });

    it('spells Reference groups the way the CSS spells them', () => {
        // Reference is title-case plural, the CSS is singular. Without this, every
        // cross-collection alias resolved to a token that does not exist.
        expect(nameFromPath('reference', ['Colors', 'Grey', 'grey-1000'])).toBe(
            '--ref-color-grey-1000',
        );
        expect(nameFromPath('reference', ['Spacings', 'spacing-xxs'])).toBe('--ref-spacing-xxs');
        expect(nameFromPath('reference', ['Icons', 'icon-sm'])).toBe('--ref-icon-sm');
    });

    it('leaves System paths alone, which are already singular and lowercase', () => {
        expect(nameFromPath('system', ['color', 'text', 'default'])).toBe(
            '--sys-color-text-default',
        );
    });

    it('splits camelCase so a family keeps its words', () => {
        expect(nameFromPath('reference', ['Colors', 'electricBlue-100'])).toBe(
            '--ref-color-electric-blue-100',
        );
    });

    it('prefixes by collection', () => {
        expect(nameFromPath('component', ['button', 'radius'])).toBe('--comp-button-radius');
    });
});

describe('collectionOf', () => {
    it('reads Figma collection names, including the alias target set', () => {
        expect(collectionOf('Reference tokens')).toBe('reference');
        expect(collectionOf('System tokens')).toBe('system');
        expect(collectionOf('Component tokens')).toBe('component');
        expect(collectionOf('Something else')).toBeNull();
    });
});

describe('parseTokensFile', () => {
    it('recovers a cross-collection alias from aliasData, not from $value', () => {
        /*
           The trap this whole module is built around. Figma RESOLVES a cross-collection
           reference into a literal colour in `$value` and preserves the relationship only in
           `$extensions`. Reading `$value` would import 92 of the 115 System colours as
           hardcoded hex — destroying the one relationship the app is about, and breaking the
           rule that a `sys` colour never holds a literal.
        */
        const { tokens } = parseTokensFile(
            {
                color: {
                    text: {
                        default: {
                            $type: 'color',
                            $value: {
                                colorSpace: 'srgb',
                                components: [0.2, 0.27, 0.39],
                                alpha: 1,
                                hex: '#344563',
                            },
                            $extensions: {
                                'com.figma.aliasData': {
                                    targetVariableName: 'Colors/Grey/grey-1000',
                                    targetVariableSetName: 'Reference tokens',
                                },
                            },
                        },
                    },
                },
            },
            'system',
        );

        expect(tokens).toHaveLength(1);
        expect(tokens[0].cssVar).toBe('--sys-color-text-default');
        expect(tokens[0].aliasOf).toBe('--ref-color-grey-1000');
        // The resolved literal is kept too — it is a free cross-check on the alias.
        expect(tokens[0].value).toBe('#344563');
        expect(tokens[0].joinedBy).toBe('path');
    });

    it('reads a same-collection alias from the curly $value', () => {
        const { tokens } = parseTokensFile(
            {
                color: {
                    icon: { default: { $type: 'color', $value: '{color.text.default}' } },
                },
            },
            'system',
        );
        expect(tokens[0].aliasOf).toBe('--sys-color-text-default');
        // A curly reference is not a literal, so there is no value to report.
        expect(tokens[0].value).toBeNull();
    });

    it('prefers codeSyntax over the path when it is usable', () => {
        const { tokens } = parseTokensFile(
            {
                Colors: {
                    white: {
                        $type: 'color',
                        $value: { hex: '#FFFFFF' },
                        $extensions: {
                            'com.figma.codeSyntax': { WEB: 'var(--ref-color-white)' },
                        },
                    },
                },
            },
            'reference',
        );
        expect(tokens[0].cssVar).toBe('--ref-color-white');
        expect(tokens[0].joinedBy).toBe('codeSyntax');
        expect(tokens[0].value).toBe('#ffffff');
    });

    it('falls back to the path when codeSyntax is unusable', () => {
        const { tokens } = parseTokensFile(
            {
                Colors: {
                    Grey: {
                        'grey-1000': {
                            $type: 'color',
                            $value: { hex: '#344563' },
                            $extensions: {
                                'com.figma.codeSyntax': { WEB: '*/ TO ADD var(--x) */' },
                            },
                        },
                    },
                },
            },
            'reference',
        );
        expect(tokens[0].cssVar).toBe('--ref-color-grey-1000');
        expect(tokens[0].joinedBy).toBe('path');
    });

    it('carries non-colour values through as strings', () => {
        const { tokens } = parseTokensFile(
            { 'Border Radius': { 'border-radius-sm': { $type: 'number', $value: 4 } } },
            'reference',
        );
        expect(tokens[0].type).toBe('number');
        expect(tokens[0].value).toBe('4');
    });

    it('walks nested groups and ignores $-prefixed metadata keys', () => {
        const { tokens } = parseTokensFile(
            {
                $description: 'ignored',
                color: {
                    surface: {
                        interactive: { default: { $type: 'color', $value: { hex: '#ABCDEF' } } },
                    },
                },
            },
            'system',
        );
        expect(tokens.map((t) => t.cssVar)).toEqual(['--sys-color-surface-interactive-default']);
    });
});

describe('resolveValues', () => {
    const token = (over: Partial<FigmaToken>): FigmaToken => ({
        cssVar: '--x',
        collection: 'system',
        type: 'color',
        value: null,
        aliasOf: null,
        figmaPath: 'x',
        joinedBy: 'path',
        ...over,
    });

    it('gives a same-collection alias the value it points at', () => {
        /*
           The bug this exists for. A cross-collection reference is exported with its colour
           resolved, but `color.icon.default` exports as `{color.text.default}` with no value —
           so all 23 System icon tokens rendered as #000000, a colour none of them holds. That
           looks like data, which is worse than showing nothing.
        */
        const icon = token({
            cssVar: '--sys-color-icon-default',
            aliasOf: '--sys-color-text-default',
        });
        const text = token({ cssVar: '--sys-color-text-default', value: '#344563' });
        resolveValues([{ tokens: [icon, text] }]);
        expect(icon.value).toBe('#344563');
    });

    it('walks a chain rather than following one hop', () => {
        const a = token({ cssVar: '--a', aliasOf: '--b' });
        const b = token({ cssVar: '--b', aliasOf: '--c' });
        const c = token({ cssVar: '--c', value: '#abcdef' });
        resolveValues([{ tokens: [a, b, c] }]);
        expect(a.value).toBe('#abcdef');
    });

    it('resolves across collections too', () => {
        const sys = token({ cssVar: '--sys-color-text-default', aliasOf: '--ref-color-grey-1000' });
        const ref = token({
            cssVar: '--ref-color-grey-1000',
            collection: 'reference',
            value: '#344563',
        });
        resolveValues([{ tokens: [sys] }, { tokens: [ref] }]);
        expect(sys.value).toBe('#344563');
    });

    it('survives a cycle instead of hanging', () => {
        // A vendored file is input, and input is not a promise.
        const a = token({ cssVar: '--a', aliasOf: '--b' });
        const b = token({ cssVar: '--b', aliasOf: '--a' });
        resolveValues([{ tokens: [a, b] }]);
        expect(a.value).toBeNull();
        expect(b.value).toBeNull();
    });

    it('leaves a token that already has a value alone', () => {
        const a = token({ cssVar: '--a', value: '#111111', aliasOf: '--b' });
        const b = token({ cssVar: '--b', value: '#222222' });
        resolveValues([{ tokens: [a, b] }]);
        expect(a.value).toBe('#111111');
    });

    it('leaves a dangling alias unresolved rather than inventing a colour', () => {
        const a = token({ cssVar: '--a', aliasOf: '--ref-color-grey-1000' });
        resolveValues([{ tokens: [a] }]);
        expect(a.value).toBeNull();
    });
});
