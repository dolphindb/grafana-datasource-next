import './index.sass'

import { useRef } from 'react'


import { Resizable } from 're-resizable'

import { request_json } from 'xshell/net.browser.js'

import {
    type QueryEditorProps,
    type DataSourceJsonData,
} from '@grafana/data'
import {
    CodeEditor,
    useTheme2,
} from '@grafana/ui'

import type * as monacoapi from 'monaco-editor/esm/vs/editor/editor.api.js'

import { generateTokensCSSForColorMap } from 'monaco-editor/esm/vs/editor/common/languages/supports/tokenization.js'
import { Color } from 'monaco-editor/esm/vs/base/common/color.js'


import {
    INITIAL,
    Registry,
    parseRawGrammar,
    type IGrammar,
    type StateStack,
} from 'vscode-textmate'
import type { IRawGrammar } from 'vscode-textmate/release/rawGrammar.js'

import { createOnigScanner, createOnigString, loadWASM } from 'vscode-oniguruma'


import { keywords, constants, tm_language } from 'dolphindb/language.js'

import { theme_light } from 'dolphindb/theme.light.js'
import { theme_dark } from 'dolphindb/theme.dark.js'



import { t, language } from './i18n/index.js'
import { fpd_root, type DataSource, type DdbDataQuery } from './components'
import React from 'react'


const constants_lower = constants.map(constant => constant.toLowerCase())

let docs = { }

let funcs: string[] = [ ]
let funcs_lower: string[] = [ ]


export function DdbCodeEditor (
    {
        height = 260,
        query: {
            queryText,
            refId,
            is_streaming,
            streaming
        },
        onChange,
        onRunQuery,
        tip = true,
    }: QueryEditorProps<DataSource, DdbDataQuery, DataSourceJsonData> & { height?: number, tip?: boolean }
) {
    const { isDark } = useTheme2()
    
    const rpinit = useRef<Promise<void>>()
    
    
    return <div className='query-editor'>
        {/* <div>
            <FormField width={4} label='Constant' type='number' step='0.1' />
            <FormField labelWidth={8} label='Query Text' tooltip='Not used yet' />
        </div> */}
        
        <Resizable
            className='resizable'
            defaultSize={{ height, width: 'auto' }}
            enable={{ top: false, right: false, bottom: true, left: false, topRight: false, bottomRight: false, bottomLeft: false, topLeft: false }}
        >
            <CodeEditor
                language='dolphindb'
                
                showLineNumbers
                
                value=''
                
                monacoOptions={{
                    minimap: {
                        enabled: false
                    },
                    
                    fontFamily: 'MyFont, Menlo, \'Ubuntu Mono\', Consolas, PingFangSC, \'Noto Sans CJK SC\', \'Microsoft YaHei\'',
                    fontSize: 16,
                    insertSpaces: true,
                    codeLensFontFamily: 'MyFont, Menlo, \'Ubuntu Mono\', Consolas, PingFangSC, \'Noto Sans CJK SC\', \'Microsoft YaHei\'',
                    folding: true,
                    largeFileOptimizations: true,
                    matchBrackets: 'always',
                    smoothScrolling: false,
                    suggest: {
                        insertMode: 'replace',
                        snippetsPreventQuickSuggestions: false,
                    },
                    
                    wordBasedSuggestions: true,
                    
                    mouseWheelZoom: true,
                    guides: {
                        indentation: false,
                        bracketPairs: false,
                        highlightActiveIndentation: false,
                    },
                    
                    detectIndentation: true,
                    tabSize: 4,
                    
                    codeLens: true,
                    roundedSelection: false,
                    wordWrap: 'on',
                    
                    scrollBeyondLastLine: false,
                    scrollbar: {
                        vertical: 'visible'
                    },
                    
                    find: {
                        loop: true,
                        seedSearchStringFromSelection: 'selection',
                    },
                    
                    acceptSuggestionOnCommitCharacter: false,
                    
                    mouseWheelScrollSensitivity: 2,
                    dragAndDrop: false,
                    renderControlCharacters: true,
                    lineNumbers: 'on',
                    showFoldingControls: 'mouseover',
                    foldingStrategy: 'indentation',
                    accessibilitySupport: 'off',
                    autoIndent: 'advanced',
                    snippetSuggestions: 'none',
                    renderLineHighlight: 'none',
                    trimAutoWhitespace: false,
                    hideCursorInOverviewRuler: true,
                    renderWhitespace: 'none',
                    overviewRulerBorder: true,
                    
                    gotoLocation: {
                        multipleDeclarations: 'peek',
                        multipleTypeDefinitions: 'peek',
                        multipleDefinitions: 'peek',
                    },
                    
                    foldingHighlight: false,
                    unfoldOnClickAfterEndOfLine: true,
                    
                    inlayHints: {
                        enabled: 'off',
                    },
                    
                    acceptSuggestionOnEnter: 'off',
                    
                    quickSuggestions: {
                        other: true,
                        comments: true,
                        strings: true,
                    },
                }}
                
                { ... onRunQuery ? {
                    onSave (queryText) {
                        onRunQuery()
                    }
                } : { } }
                
                onBeforeEditorMount={monaco => {
                    rpinit.current = (async () => {
                        if ((monaco as any).inited)
                            return
                        
                        (monaco as any).inited = true
                        
                        let { languages, editor } = monaco
                        
                        const { CompletionItemKind } = languages
                        
                        
                        ;(async () => {
                            const fname = `docs.${ language === 'zh' ? 'zh' : 'en' }.json`
                            
                            docs = await request_json(fpd_root + '/static/' + fname)
                            
                            funcs = Object.keys(docs)
                            funcs_lower = funcs.map(func => 
                                func.toLowerCase())
                            
                            console.log(t('函数文档 {{fname}} 已加载', { fname }))
                        })()
                        
                        // Using the response directly only works if the server sets the MIME type 'application/wasm'.
                        // Otherwise, a TypeError is thrown when using the streaming compiler.
                        // We therefore use the non-streaming compiler :(.
                        await loadWASM(await fetch(`${fpd_root}/static/onig.wasm`))
                        
                        
                        languages.register({
                            id: 'dolphindb',
                            // configuration: ''
                        })
                        
                        
                        languages.setTokensProvider(
                            'dolphindb',
                            
                            await new TokensProviderCache(registry)
                                .createEncodedTokensProvider(
                                    'source.dolphindb',
                                    languages.getEncodedLanguageId('dolphindb')
                                )
                        )
                        
                        
                        languages.setLanguageConfiguration('dolphindb', {
                            comments: {
                                // symbol used for single line comment. Remove this entry if your language does not support line comments
                                lineComment: '//',
                                
                                // symbols used for start and end a block comment. Remove this entry if your language does not support block comments
                                blockComment: ['/*', '*/']
                            },
                            
                            // symbols used as brackets
                            brackets: [
                                ['{', '}'],
                                ['[', ']'],
                                ['(', ')']
                            ],
                            
                            // symbols that are auto closed when typing
                            autoClosingPairs: [
                                { open: '{', close: '}' },
                                { open: '[', close: ']' },
                                { open: '(', close: ')' },
                                { open: '"', close: '"', notIn: ['string'] },
                                { open: "'", close: "'", notIn: ['string'] },
                                { open: '/**', close: ' */', notIn: ['string'] },
                                { open: '/*', close: ' */', notIn: ['string'] }
                            ],
                            
                            // symbols that that can be used to surround a selection
                            surroundingPairs: [
                                { open: '{', close: '}' },
                                { open: '[', close: ']' },
                                { open: '(', close: ')' },
                                { open: '"', close: '"' },
                                { open: "'", close: "'" },
                                { open: '<', close: '>' },
                            ],
                            
                            folding: {
                                markers: {
                                    start: new RegExp('^\\s*//\\s*#?region\\b'),
                                    end: new RegExp('^\\s*//\\s*#?endregion\\b')
                                }
                            },
                            
                            wordPattern: new RegExp('(-?\\d*\\.\\d\\w*)|([^\\`\\~\\!\\@\\#\\%\\^\\&\\*\\(\\)\\-\\=\\+\\[\\{\\]\\}\\\\\\|\\;\\:\\\'\\"\\,\\.\\<\\>\\/\\?\\s]+)'),
                            
                            indentationRules: {
                                increaseIndentPattern: new RegExp('^((?!\\/\\/).)*(\\{[^}"\'`]*|\\([^)"\'`]*|\\[[^\\]"\'`]*)$'),
                                decreaseIndentPattern: new RegExp('^((?!.*?\\/\\*).*\\*/)?\\s*[\\}\\]].*$')
                            }
                        })
                        
                        languages.registerCompletionItemProvider('dolphindb', {
                            // @ts-ignore
                            provideCompletionItems (doc, pos, ctx, canceller) {
                                if (canceller.isCancellationRequested)
                                    return
                                
                                const keyword = doc.getWordAtPosition(pos).word
                                
                                
                                let fns: string[]
                                let _constants: string[]
                                
                                if (keyword.length === 1) {
                                    const c = keyword[0].toLowerCase()
                                    fns = funcs.filter((func, i) =>
                                        funcs_lower[i].startsWith(c)
                                    )
                                    _constants = constants.filter((constant, i) =>
                                        constants_lower[i].startsWith(c)
                                    )
                                } else {
                                    const keyword_lower = keyword.toLowerCase()
                                    
                                    fns = funcs.filter((func, i) => {
                                        const func_lower = funcs_lower[i]
                                        let j = 0
                                        for (const c of keyword_lower) {
                                            j = func_lower.indexOf(c, j) + 1
                                            if (!j)  // 找不到则 j === 0
                                                return false
                                        }
                                        
                                        return true
                                    })
                                    
                                    _constants = constants.filter((constant, i) => {
                                        const constant_lower = constants_lower[i]
                                        let j = 0
                                        for (const c of keyword_lower) {
                                            j = constant_lower.indexOf(c, j) + 1
                                            if (!j)  // 找不到则 j === 0
                                                return false
                                        }
                                        
                                        return true
                                    })
                                }
                                
                                return {
                                    suggestions: [
                                        ...keywords.filter(kw =>
                                            kw.startsWith(keyword)
                                        ).map(kw => ({
                                            label: kw,
                                            insertText: kw,
                                            kind: CompletionItemKind.Keyword,
                                        }) as monacoapi.languages.CompletionItem),
                                        ... _constants.map(constant => ({
                                            label: constant,
                                            insertText: constant,
                                            kind: CompletionItemKind.Constant
                                        }) as monacoapi.languages.CompletionItem),
                                        ...fns.map(fn => ({
                                            label: fn,
                                            insertText: fn,
                                            kind: CompletionItemKind.Function,
                                        }) as monacoapi.languages.CompletionItem),
                                    ]
                                }
                            },
                            
                            resolveCompletionItem (item, canceller) {
                                if (canceller.isCancellationRequested)
                                    return
                                
                                // @ts-ignore
                                item.documentation = get_func_md(item.label as string)
                                
                                return item
                            }
                        })
                        
                        languages.registerHoverProvider('dolphindb', {
                            // @ts-ignore
                            provideHover (doc, pos, canceller) {
                                if (canceller.isCancellationRequested)
                                    return
                                
                                const word = doc.getWordAtPosition(pos)
                                
                                if (!word)
                                    return
                                
                                const md = get_func_md(word.word)
                                
                                if (!md)
                                    return
                                
                                return {
                                    contents: [md]
                                }
                            }
                        })
                        
                        languages.registerSignatureHelpProvider('dolphindb', {
                            signatureHelpTriggerCharacters: ['(', ','],
                            
                            // @ts-ignore
                            provideSignatureHelp (doc, pos, canceller, ctx) {
                                if (canceller.isCancellationRequested)
                                    return
                                
                                // @ts-ignore
                                const { func_name, param_search_pos } = find_func_start(doc, pos)
                                if (param_search_pos === -1)
                                    return
                                
                                // @ts-ignore
                                const index = find_active_param_index(doc, pos, param_search_pos)
                                if (index === -1)
                                    return
                                
                                const signature_and_params = get_signature_and_params(func_name)
                                if (!signature_and_params)
                                    return
                                
                                const { signature, params } = signature_and_params
                                
                                return {
                                    dispose () { },
                                    
                                    value: {
                                        activeParameter: index > params.length - 1 ? params.length - 1 : index,
                                        signatures: [{
                                            label: signature,
                                            documentation: get_func_md(func_name),
                                            parameters: params.map(param => ({
                                                label: param
                                            }))
                                        }],
                                        activeSignature: 0,
                                    }
                                }
                            }
                        })
                        
                        
                        await document.fonts.ready
                    })()
                }}
                
                onEditorDidMount={async (editor, monaco) => {
                    await rpinit.current
                        
                    editor.setValue(queryText || '')
                    
                    editor.getModel().onDidChangeContent(event => {
                        onChange({
                            refId,
                            is_streaming,
                            queryText: editor.getValue().replaceAll('\r\n', '\n'),
                            streaming
                        })
                    })
                    
                    
                    editor.addAction({
                        id: 'duplicate_line',
                        
                        keybindings: [
                            monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyD
                        ],
                        
                        label: t('向下复制行'),
                        
                        // @ts-ignore
                        async run (editor: monacoapi.editor.IStandaloneCodeEditor) {
                            await editor.getAction('editor.action.copyLinesDownAction').run()
                        }
                    })
                    
                    editor.addAction({
                        id: 'delete_lines',
                        
                        keybindings: [
                            monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY
                        ],
                        
                        label: t('删除行'),
                        
                        // @ts-ignore
                        async run (editor: monacoapi.editor.IStandaloneCodeEditor) {
                            await editor.getAction('editor.action.deleteLines').run()
                        }
                    })
                    
                    
                    let { widget } = editor.getContribution('editor.contrib.suggestController') as any
                    
                    if (widget) {
                        const { value: suggest_widget } = widget
                        suggest_widget._setDetailsVisible(true)
                        // suggest_widget._persistedSize.store({
                        //     width: 200,
                        //     height: 256
                        // })
                    }
                    
                    
                    registry.setTheme(isDark ? theme_dark : theme_light)
                    
                    inject_css()
                }}
            />
        </Resizable>
        
        { tip && <div className='editor-tip'>{t('在编辑器中按 Ctrl + S 可暂存查询并刷新结果')}</div> }
    </div>
}



// ------------ tokenizer
// 方法来自: https://github.com/bolinfest/monaco-tm/

interface ScopeNameInfo {
    /** 
        If set, this is the id of an ILanguageExtensionPoint. This establishes the
        mapping from a MonacoLanguage to a TextMate grammar.
    */
    language?: string
    
    /** 
        Scopes that are injected *into* this scope. For example, the
        `text.html.markdown` scope likely has a number of injections to support
        fenced code blocks.
    */
    injections?: string[]
}


interface DemoScopeNameInfo extends ScopeNameInfo {
    path: string
}


const grammars: {
    [scopeName: string]: DemoScopeNameInfo
} = {
    'source.dolphindb': {
        language: 'dolphindb',
        path: 'dolphindb.tmLanguage.json'
    }
}


let registry = new Registry({
    onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
    
    async loadGrammar (scopeName: string): Promise<IRawGrammar | null> {
        const scopeNameInfo = grammars[scopeName]
        // eslint-disable-next-line
        if (scopeNameInfo == null) 
            return null
        
        const grammar_text: string = JSON.stringify(tm_language)
        
        // If this is a JSON grammar, filePath must be specified with a `.json`
        // file extension or else parseRawGrammar() will assume it is a PLIST
        // grammar.
        return parseRawGrammar(grammar_text, 'dolphindb.json')
    },
    
    /** 
        For the given scope, returns a list of additional grammars that should be
        "injected into" it (i.e., a list of grammars that want to extend the
        specified `scopeName`). The most common example is other grammars that
        want to "inject themselves" into the `text.html.markdown` scope so they
        can be used with fenced code blocks.
        
        In the manifest of a VS Code extension,  grammar signals that it wants
        to do this via the "injectTo" property:
        https://code.visualstudio.com/api/language-extensions/syntax-highlight-guide#injection-grammars
    */
    getInjections (scopeName: string): string[] | undefined {
        const grammar = grammars[scopeName]
        return grammar ? grammar.injections : undefined
    },
})


class TokensProviderCache {
    private scopeNameToGrammar: Map<string, Promise<IGrammar>> = new Map()
    
    constructor (private registry: Registry) { }
    
    async createEncodedTokensProvider (scopeName: string, encodedLanguageId: number): Promise<monacoapi.languages.EncodedTokensProvider> {
        const grammar = await this.getGrammar(scopeName, encodedLanguageId)
        
        return {
            getInitialState () {
                return INITIAL
            },
            
            tokenizeEncoded (line: string, state: monacoapi.languages.IState): monacoapi.languages.IEncodedLineTokens {
                const tokenizeLineResult2 = grammar.tokenizeLine2(line, state as StateStack)
                const { tokens, ruleStack: endState } = tokenizeLineResult2
                return { tokens, endState }
            }
        }
    }
    
    async getGrammar (scopeName: string, encodedLanguageId: number): Promise<IGrammar> {
        const grammar = this.scopeNameToGrammar.get(scopeName)
        // eslint-disable-next-line
        if (grammar != null) 
            return grammar
        
        
        // This is defined in vscode-textmate and has optional embeddedLanguages
        // and tokenTypes fields that might be useful/necessary to take advantage of
        // at some point.
        const grammarConfiguration = { }
        
        // We use loadGrammarWithConfiguration() rather than loadGrammar() because
        // we discovered that if the numeric LanguageId is not specified, then it
        // does not get encoded in the TokenMetadata.
        //
        // Failure to do so means that the LanguageId cannot be read back later,
        // which can cause other Monaco features, such as "Toggle Line Comment",
        // to fail.
        const promise = this.registry
            .loadGrammarWithConfiguration(scopeName, encodedLanguageId, grammarConfiguration)
            .then((grammar: IGrammar | null) => {
                if (grammar) 
                    return grammar
                 else 
                    throw Error(`failed to load grammar for ${scopeName}`)
            })
        this.scopeNameToGrammar.set(scopeName, promise)
        return promise
    }
}


function create_style_element_for_colors_css (): HTMLStyleElement {
    // We want to ensure that our <style> element appears after Monaco's so that
    // we can override some styles it inserted for the default theme.
    const style = document.createElement('style')
    
    // We expect the styles we need to override to be in an element with the class
    // name 'monaco-colors' based on:
    // https://github.com/microsoft/vscode/blob/f78d84606cd16d75549c82c68888de91d8bdec9f/src/vs/editor/standalone/browser/standaloneThemeServiceImpl.ts#L206-L214
    const monacoColors = document.getElementsByClassName('monaco-colors')[0]
    if (monacoColors) 
        monacoColors.parentElement?.insertBefore(style, monacoColors.nextSibling)
     else {
        // Though if we cannot find it, just append to <head>.
        let { head } = document
        // eslint-disable-next-line
        if (head == null) 
            head = document.getElementsByTagName('head')[0]
        
        head?.appendChild(style)
    }
    return style
}

/** 
    Be sure this is done after Monaco injects its default styles so that the
    injected CSS overrides the defaults.
*/
function inject_css () {
    const css_colors = registry.getColorMap()
    const colorMap = css_colors.map(Color.Format.CSS.parseHex)
    const css = generateTokensCSSForColorMap(colorMap)
    const style = create_style_element_for_colors_css()
    style.innerHTML = css
}


// ------------ 函数补全、文档

/** 最大搜索行数 */
const max_lines_to_match = 30 as const

// 栈 token 匹配表
const token_map = {
    ')': '(',
    '}': '{',
    ']': '['
} as const

const token_ends = new Set(
    Object.values(token_map)
)


interface RstDocument {
    title: string
    type: DocumentType
    children: Paragraph[]
}

interface Paragraph {
    type: ParagraphType
    title: string
    children: ContextBlock[]
}

interface ContextBlock {
    type: 'text' | 'code'
    language?: string
    value: string[]
}

type DocumentType = 'command' | 'function' | 'template'

type ParagraphType = 'grammer' | 'parameters' | 'detail' | 'example'


const func_fps = {
    command: 'FunctionsandCommands/CommandsReferences/',
    function: 'FunctionsandCommands/FunctionReferences/',
    template: 'Functionalprogramming/TemplateFunctions/'
} as const


function get_func_md (keyword: string) {
    const func_doc: RstDocument = docs[keyword] || docs[keyword + '!']
    
    if (!func_doc)
        return
    
    const { title, type } = func_doc
    
    let str = 
        // 标题
        `#### ${title}\n` +
        
        // 链接
        'https://' + 
        (language === 'zh' ? 'docs.dolphindb.cn/zh/' : 'dolphindb.com/') +
        'help/' +
        func_fps[type] +
        (type !== 'template' ? `${title[0]}/` : '') +
        title + '.html\n'
    
    
    for (const para of func_doc.children) {
        // 加入段
        str += `#### ${para.title}\n`
        
        for (const x of para.children)
            if (x.type === 'text' && para.type !== 'example') 
                // 对于参数段落，以 markdown 插入
                str += x.value.join_lines()
            else
                // x.type === 'code' || para.type === 'example'
                str += 
                    '```' + (x.language === 'console' ? 'dolphindb' : (x.language || '')) + '\n' +
                    x.value.join_lines() +
                    '```\n'
        
        str += '\n'
    }
    
    return {
        isTrusted: true,
        value: str
    } as monacoapi.IMarkdownString
}


/** 利用当前光标找出函数参数开始位置及函数名, 若找不到返回 -1 */
function find_func_start (
    document: monacoapi.editor.ITextModel,
    position: monacoapi.Position
): {
    func_name: string
    param_search_pos: number
} {
    const func_name_regex = /[a-z|A-Z|0-9|\!|_]/
    
    const text = document.getValueInRange({
        startLineNumber: Math.max(position.lineNumber - max_lines_to_match, 0),
        startColumn: 0,
        endLineNumber: position.lineNumber,
        endColumn: position.column
    })
    
    
    let stack_depth = 0
    let param_search_pos = -1
    for (let i = text.length;  i >= 0;  i--) {
        let char = text[i]
        // 遇到右括号，入栈，增加一层括号语境深度
        if (char === ')') {
            stack_depth++
            continue
        }
        // 遇到左括号，出栈，退出一层括号语境深度
        else if (char === '(') {
            stack_depth--
            continue
        }
        
        // 栈深度小于0，且遇到合法函数名字符，跳出括号语境，搜索结束：参数搜索开始位置
        if (func_name_regex.test(char) && stack_depth < 0) {
            param_search_pos = i
            break
        }
    }
    
    // 找不到参数搜索开始位置，返回null
    if (param_search_pos === -1) 
        return { param_search_pos: -1, func_name: '' }
    
    
    // 往前找函数名
    let func_name_end = -1
    let func_name_start = 0
    for (let i = param_search_pos;  i >= 0;  i--) {
        let char = text[i]
        
        // 空字符跳过
        if (func_name_end === -1 && char === ' ') 
            continue
        
        // 合法函数名字字符，继续往前找
        if (func_name_regex.test(char)) {
            // 标记函数名字末尾位置
            if (func_name_end === -1) 
                func_name_end = i
            
            continue
        }
        
        // 不合法函数名字符，标记函数名字开头位置
        func_name_start = i + 1
        break
    }
    
    // 找不到函数名
    if (func_name_end === -1) 
        return { param_search_pos: -1, func_name: '' }
    
    return {
        param_search_pos: param_search_pos + 1,
        func_name: text.slice(func_name_start, func_name_end + 1)
    }
}



/** 根据函数参数开始位置分析参数语义，提取出当前参数索引  */
function find_active_param_index (
    document: monacoapi.editor.ITextModel,
    position: monacoapi.Position,
    start: number
) {
    const text = document.getValueInRange({
        startLineNumber: Math.max(position.lineNumber - max_lines_to_match, 0),
        startColumn: 0,
        endLineNumber: position.lineNumber,
        endColumn: position.column
    })
    
    let index = 0
    let stack = [ ]
    
    // 分隔符，此处为逗号
    const seperator = ','
    
    let ncommas = 0
    
    // 搜索
    for (let i = start;  i < text.length;  i++) {
        const char = text[i]
        
        // 空字符跳过
        if (/\s/.test(char)) 
            continue
        
        // 字符串内除引号全部忽略
        if (stack[stack.length - 1] === '"' || stack[stack.length - 1] === "'") {
            // 遇到相同引号，出栈
            if ((stack[stack.length - 1] === '"' && char === '"') || (stack[stack.length - 1] === "'" && char === "'")) 
                stack.pop()
            continue
        }
        
        // 开括号入栈
        if (token_ends.has(char as any) || char === '"' || char === "'") {
            stack.push(char)
            continue
        } else if (char in token_map)  // 括号匹配，出栈，括号不匹配，返回null
            if (stack[stack.length - 1] === token_map[char]) {
                stack.pop()
                continue
            } else // 括号不匹配，返回-1
                return -1
        
        // 栈深度为1 且为左小括号：当前语境
        if (stack.length === 1 && stack[0] === '(') 
            // 遇到逗号，若之前有合法参数，计入逗号
            if (char === seperator)
                ncommas++
        
        // 根据逗号数量判断高亮参数索引值
        index = ncommas
    }
    
    return index
}


/** 根据函数名提取出相应的文件对象，提取出函数signature和参数 */
function get_signature_and_params (func_name: string): {
    signature: string
    params: string[]
} | null {
    const para = docs[func_name]?.children.filter(para => para.type === 'grammer')[0]
    if (!para) 
        return null
    
    // 找出语法内容块的第一个非空行
    const funcLine = para.children[0].value.filter(line => line.trim() !== '')[0].trim()
    const matched = funcLine.match(/[a-zA-z0-9\!]+\((.*)\)/)
    if (!matched) 
        return null
    
    const signature = matched[0]
    const params = matched[1].split(',').map(s => s.trim())
    return { signature, params }
}

