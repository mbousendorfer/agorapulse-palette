/**
 * Read a Figma variables `.zip` export, with no dependency.
 *
 * A zip is a list of entries followed by a central directory, and the compression is
 * raw deflate — which every runtime this app targets can already undo through
 * `DecompressionStream('deflate-raw')`. Node has had it since 18 and the browsers this
 * tool runs in all ship it, so ONE implementation serves both the npm script and the
 * upload page. The alternative was a dependency for something the platform does.
 *
 * Deliberately minimal: it reads the central directory (never the local headers' sizes,
 * which are allowed to be zero when a data descriptor follows), handles the only two
 * compression methods Figma emits, and refuses anything else loudly rather than
 * returning half a file. It is not a general zip library and should not become one.
 */

/** One file in the archive. */
export interface ZipEntry {
    name: string;
    text: string;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

/** Stored — no compression at all. Small JSON sometimes lands here. */
const STORED = 0;
/** Deflate, which is what `DecompressionStream('deflate-raw')` undoes. */
const DEFLATED = 8;

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
    const stream = new Blob([bytes as BlobPart])
        .stream()
        .pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Find the End Of Central Directory record.
 *
 * Searched BACKWARDS from the end, because the record sits last and its signature can
 * legitimately occur inside compressed data — scanning forwards would find a false one
 * in a large archive. The 22-byte minimum is the record with an empty comment.
 */
function findEocd(view: DataView): number {
    for (let at = view.byteLength - 22; at >= 0; at--) {
        if (view.getUint32(at, true) === EOCD_SIGNATURE) return at;
    }
    throw new Error('Not a zip file: no end-of-central-directory record.');
}

/**
 * Every `.json` entry in the archive, decoded as text.
 *
 * Directories and anything not `.json` are skipped rather than reported: macOS adds
 * `__MACOSX/` and `.DS_Store` to any archive made in Finder, and failing on those would
 * make the feature depend on how the file was zipped.
 */
export async function readZipJson(buffer: ArrayBuffer): Promise<ZipEntry[]> {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    const eocd = findEocd(view);

    const count = view.getUint16(eocd + 10, true);
    let at = view.getUint32(eocd + 16, true);

    const out: ZipEntry[] = [];
    const decoder = new TextDecoder();

    for (let i = 0; i < count; i++) {
        if (view.getUint32(at, true) !== CENTRAL_SIGNATURE) {
            throw new Error(`Corrupt zip: central directory entry ${i + 1} has a bad signature.`);
        }
        const method = view.getUint16(at + 10, true);
        const compressedSize = view.getUint32(at + 20, true);
        const nameLength = view.getUint16(at + 28, true);
        const extraLength = view.getUint16(at + 30, true);
        const commentLength = view.getUint16(at + 32, true);
        const localOffset = view.getUint32(at + 42, true);
        const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));

        at += 46 + nameLength + extraLength + commentLength;

        if (name.endsWith('/')) continue;
        if (!name.endsWith('.json')) continue;
        // Finder's own metadata, which is not part of the export.
        if (name.startsWith('__MACOSX/') || name.includes('/.')) continue;

        /* The local header's name and extra fields have their OWN lengths, which need not
           match the central directory's — reusing the central ones here is a classic way
           to read a few bytes into the payload. */
        const localNameLength = view.getUint16(localOffset + 26, true);
        const localExtraLength = view.getUint16(localOffset + 28, true);
        const dataAt = localOffset + 30 + localNameLength + localExtraLength;
        const payload = bytes.subarray(dataAt, dataAt + compressedSize);

        if (method === STORED) {
            out.push({ name, text: decoder.decode(payload) });
        } else if (method === DEFLATED) {
            out.push({ name, text: decoder.decode(await inflateRaw(payload)) });
        } else {
            throw new Error(
                `${name} uses compression method ${method}, which this reader does not ` +
                    `handle. Re-export from Figma rather than re-zipping the files.`,
            );
        }
    }

    if (out.length === 0) throw new Error('That archive holds no .json file.');
    return out;
}
