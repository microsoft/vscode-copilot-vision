
import screenshot from 'screenshot-desktop';
import * as path from 'path';
import * as os from 'os';

const activeWin = import('active-win');
import sharp from 'sharp';
import { promises as fs } from 'fs';

export async function generateFocusedWindowScreenshotPath(): Promise<string | undefined> {
    try {
        const tmpDir = os.tmpdir();
        const imgPath = path.join(tmpDir, 'screenshot.jpg');

        const window = await (await activeWin).activeWindow();
        if (!window || !window.bounds) {
            throw new Error('No focused window detected.');
        }

        const { x, y, width, height } = window.bounds;

        const imgBuffer: Buffer = await screenshot({ format: 'jpg' });

        const croppedImage = await sharp(imgBuffer)
            .extract({ left: x, top: y, width, height })
            .toBuffer();

        // Ensure the temporary directory exists
        await fs.mkdir(path.dirname(imgPath), { recursive: true });

        await fs.writeFile(imgPath, croppedImage);

        return imgPath;
    } catch (err) {
        console.error('Error taking screenshot:', err);
        return undefined;
    }
}

export function generateIdUsingDateTime(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const milliseconds = String(now.getMilliseconds()).padStart(3, '0');

    return `${year}${month}${day}${hours}${minutes}${seconds}${milliseconds}`;
}