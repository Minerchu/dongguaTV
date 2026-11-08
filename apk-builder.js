const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const TEMPLATE_APK = process.env.APK_TEMPLATE || path.join(__dirname, 'server-assets', 'donggua-template.apk');
const APKTOOL_JAR = process.env.APKTOOL_JAR || '/opt/apktool.jar';
const BUILD_TOOLS = process.env.ANDROID_BUILD_TOOLS || '/opt/android-build-tools';
const BUILD_TIMEOUT = Number(process.env.APK_BUILD_TIMEOUT) || 12 * 60 * 1000;

function buildEnv() {
    return {
        ...process.env,
        PATH: `${BUILD_TOOLS}${path.delimiter}${process.env.PATH || ''}`
    };
}

function tool(name) {
    const local = path.join(BUILD_TOOLS, name);
    return fs.existsSync(local) ? local : name;
}

function run(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env || buildEnv(),
            windowsHide: true
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const append = (target, chunk) => {
            const text = chunk.toString();
            const next = target + text;
            return next.length > 24000 ? next.slice(-24000) : next;
        };
        child.stdout.on('data', chunk => { stdout = append(stdout, chunk); });
        child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            try { child.kill('SIGKILL'); } catch (e) { }
            reject(new Error(`构建步骤超时：${path.basename(command)}`));
        }, options.timeout || BUILD_TIMEOUT);
        child.on('error', error => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(new Error(`无法执行 ${command}：${error.message}`));
        });
        child.on('close', code => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (code === 0) return resolve(stdout);
            const detail = (stderr || stdout || '').trim().split('\n').slice(-14).join('\n');
            reject(new Error(`${path.basename(command)} 失败（退出码 ${code}）${detail ? '：' + detail : ''}`));
        });
    });
}

function isAvailable() {
    return fs.existsSync(TEMPLATE_APK) && fs.existsSync(APKTOOL_JAR);
}

function escapeXml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

async function ensureKeystore(dataDir) {
    const androidDir = path.join(dataDir, 'android-client');
    const keystore = path.join(androidDir, 'signing.jks');
    const passwordFile = path.join(androidDir, 'signing.pass');
    if (fs.existsSync(keystore) && fs.existsSync(passwordFile)) {
        const password = fs.readFileSync(passwordFile, 'utf8').trim();
        if (password) return { keystore, password, alias: 'dongguatv' };
    }
    fs.mkdirSync(androidDir, { recursive: true });
    const password = crypto.randomBytes(24).toString('base64url');
    fs.writeFileSync(passwordFile, password, { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(passwordFile, 0o600); } catch (e) { }
    await run('keytool', [
        '-genkeypair',
        '-keystore', keystore,
        '-storetype', 'PKCS12',
        '-alias', 'dongguatv',
        '-keyalg', 'RSA',
        '-keysize', '2048',
        '-validity', '10000',
        '-storepass', password,
        '-keypass', password,
        '-dname', 'CN=DongguaTV, O=Self Hosted, C=CN',
        '-noprompt'
    ]);
    return { keystore, password, alias: 'dongguatv' };
}

function updateVersionInfo(yml, android) {
    const lines = yml.split(/\r?\n/);
    let inVersion = false;
    let replaced = false;
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed === 'versionInfo:') {
            inVersion = true;
            continue;
        }
        if (inVersion && /^versionCode:/.test(trimmed)) {
            const indent = lines[i].match(/^\s*/)[0];
            lines[i] = `${indent}versionCode: '${android.versionCode}'`;
            replaced = true;
            continue;
        }
        if (inVersion && /^versionName:/.test(trimmed)) {
            const indent = lines[i].match(/^\s*/)[0];
            lines[i] = `${indent}versionName: ${android.versionName}`;
            replaced = true;
            continue;
        }
        if (inVersion && trimmed && !/^\s/.test(lines[i])) break;
    }
    if (!replaced) {
        lines.push('versionInfo:', `  versionCode: '${android.versionCode}'`, `  versionName: ${android.versionName}`);
    }
    return lines.join('\n');
}

function replaceAppName(decodedDir, appName) {
    const stringsFile = path.join(decodedDir, 'res', 'values', 'strings.xml');
    if (!fs.existsSync(stringsFile)) throw new Error('模板中缺少 res/values/strings.xml');
    let xml = fs.readFileSync(stringsFile, 'utf8');
    const replacement = `<string name="app_name">${escapeXml(appName)}</string>`;
    if (/<string name="app_name">[\s\S]*?<\/string>/.test(xml)) {
        xml = xml.replace(/<string name="app_name">[\s\S]*?<\/string>/, replacement);
    } else {
        xml = xml.replace('</resources>', `    ${replacement}\n</resources>`);
    }
    fs.writeFileSync(stringsFile, xml, 'utf8');
}

function replaceIcons(decodedDir, iconPath) {
    if (!iconPath || !fs.existsSync(iconPath)) return;
    const resDir = path.join(decodedDir, 'res');
    if (!fs.existsSync(resDir)) return;
    const dirs = fs.readdirSync(resDir, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && entry.name.startsWith('mipmap'))
        .map(entry => path.join(resDir, entry.name));
    if (dirs.length === 0) {
        dirs.push(path.join(resDir, 'mipmap-xxxhdpi'));
        fs.mkdirSync(dirs[0], { recursive: true });
    }
    for (const dir of dirs) {
        for (const file of fs.readdirSync(dir)) {
            if (/^ic_launcher\./.test(file)) fs.rmSync(path.join(dir, file), { force: true });
        }
        fs.copyFileSync(iconPath, path.join(dir, 'ic_launcher.png'));
    }
}

function writeAppConfig(decodedDir, android) {
    const assetsDir = path.join(decodedDir, 'assets');
    fs.mkdirSync(assetsDir, { recursive: true });
    const config = {
        serverUrl: android.serverUrl,
        appName: android.appName,
        versionName: android.versionName,
        versionCode: android.versionCode
    };
    fs.writeFileSync(path.join(assetsDir, 'app-config.json'), JSON.stringify(config, null, 2), 'utf8');
}

async function buildApk(options) {
    if (!isAvailable()) {
        throw new Error('APK 模板尚未安装，请使用项目提供的 Docker 镜像运行');
    }
    const android = options.android;
    const dataDir = options.dataDir;
    if (!android || !android.serverUrl) throw new Error('请先填写服务器地址');
    const workRoot = path.join(dataDir, 'android-client');
    fs.mkdirSync(workRoot, { recursive: true });
    const workDir = fs.mkdtempSync(path.join(workRoot, 'build-'));
    const decodedDir = path.join(workDir, 'decoded');
    const unsignedApk = path.join(workDir, 'unsigned.apk');
    const alignedApk = path.join(workDir, 'aligned.apk');
    const signedApk = path.join(workDir, 'signed.apk');
    try {
        await run('java', ['-jar', APKTOOL_JAR, 'd', '-f', '-o', decodedDir, TEMPLATE_APK, '--use-aapt2']);
        replaceAppName(decodedDir, android.appName);
        replaceIcons(decodedDir, android.iconPath);
        writeAppConfig(decodedDir, android);
        const ymlFile = path.join(decodedDir, 'apktool.yml');
        if (fs.existsSync(ymlFile)) {
            const yml = fs.readFileSync(ymlFile, 'utf8');
            fs.writeFileSync(ymlFile, updateVersionInfo(yml, android), 'utf8');
        }
        await run('java', ['-jar', APKTOOL_JAR, 'b', decodedDir, '-o', unsignedApk, '--use-aapt2']);
        if (!fs.existsSync(unsignedApk)) throw new Error('apktool 没有生成 APK');
        await run(tool('zipalign'), ['-f', '-p', '4', unsignedApk, alignedApk]);
        const signing = await ensureKeystore(dataDir);
        await run(tool('apksigner'), [
            'sign',
            '--ks', signing.keystore,
            '--ks-key-alias', signing.alias,
            '--ks-pass', `pass:${signing.password}`,
            '--key-pass', `pass:${signing.password}`,
            '--out', signedApk,
            alignedApk
        ]);
        await run(tool('apksigner'), ['verify', '--print-certs', signedApk]);
        const finalDir = path.join(dataDir, 'android-client');
        fs.mkdirSync(finalDir, { recursive: true });
        const finalApk = path.join(finalDir, 'donggua-tv.apk');
        const tempFinal = finalApk + '.tmp';
        fs.copyFileSync(signedApk, tempFinal);
        fs.renameSync(tempFinal, finalApk);
        const buffer = fs.readFileSync(finalApk);
        return {
            size: buffer.length,
            sha256: crypto.createHash('sha256').update(buffer).digest('hex')
        };
    } finally {
        if (process.env.APK_KEEP_WORK !== '1') {
            try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (e) { }
        }
    }
}

module.exports = { buildApk, ensureKeystore, isAvailable, TEMPLATE_APK, APKTOOL_JAR };
