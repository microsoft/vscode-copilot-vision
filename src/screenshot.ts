
import screenshot from 'screenshot-desktop';
import * as path from 'path';
import * as os from 'os';

export async function generateScreenshotPath(): Promise<string | undefined> {
    try {
        const tmpDir = os.tmpdir();
        const imgPath = path.join(tmpDir, 'screenshot.jpg');
        await screenshot({ filename: imgPath });
        return imgPath;
    } catch (err) {
        console.error('Error taking screenshot:', err);
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