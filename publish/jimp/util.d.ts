declare namespace util {
    function parseFormat(command: string, mimeType?: string): [string, string, string];
    function getExtension(mimeType: string | undefined): string | undefined;
    function renameExt(output: string, ext: string, replace?: boolean): string;
    function normalizePath(value: string): string;
    function getWebP_bin(name: string, pathname: string | undefined): string;
    function showInputType(value: string | undefined, outputType: string, finalAs: string): string;
    function showOutputType(value: string | undefined, outputType: string, finalAs: string): string;
}

export = util;