const core = require('@actions/core');
const github = require('@actions/github');
const COS = require('cos-nodejs-sdk-v5');
const fs = require('fs');
const Path = require('path');
const request = require('request');
const crypto = require('crypto');

const walk = async (path, walkFn) => {
    stats = await fs.promises.lstat(path);
    if (!stats.isDirectory()) {
        return await walkFn(path);
    }

    const dir = await fs.promises.opendir(path);
    for await (const dirent of dir) {
        await walk(Path.join(path, dirent.name), walkFn);
    }
}

const uploadFileToCOS = (cos, path) => {
    return new Promise((resolve, reject) => {
        cos.cli.putObject({
            Bucket: cos.bucket,
            Region: cos.region,
            Key: Path.join(cos.remotePath, path),
            StorageClass: 'STANDARD',
            Body: fs.createReadStream(Path.join(cos.localPath, path)),
        }, function(err, data) {
            if (err) {
                return reject(err);
            } else {
                return resolve(data);
            }
        });
    });
}

const deleteFileFromCOS = (cos, path) => {
    return new Promise((resolve, reject) => {
        cos.cli.deleteObject({
            Bucket: cos.bucket,
            Region: cos.region,
            Key: Path.join(cos.remotePath, path)
        }, function(err, data) {
            if (err) {
                return reject(err);
            } else {
                return resolve(data);
            }
        });
    });
}

const listFilesOnCOS = (cos, nextMarker) => {
    return new Promise((resolve, reject) => {
        cos.cli.getBucket({
            Bucket: cos.bucket,
            Region: cos.region,
            Prefix: cos.remotePath,
            NextMarker: nextMarker
        }, function(err, data) {
            if (err) {
                return reject(err);
            } else {
                return resolve(data);
            }
        });
    });
}

const collectLocalFiles = async (cos) => {
    const root = cos.localPath;
    const files = new Set();
    await walk(root, (path) => {
        let p = path.substring(root.length);
        for (;p[0] === '/';) {
            p = p.substring(1);
        }
        files.add(p);
    });
    return files;
}

const uploadFiles = async (cos, localFiles) => {
    const size = localFiles.size;
    let index = 0;
    let percent = 0;
    for (const file of localFiles) {
        await uploadFileToCOS(cos, file);
        index++;
        percent = parseInt(index / size * 100);
        console.log(`>> [${index}/${size}, ${percent}%] uploaded ${Path.join(cos.localPath, file)}`);
    }
}

const collectRemoteFiles = async (cos) => {
    const files = new Set();
    let data = {};
    let nextMarker = null;

    do {
        data = await listFilesOnCOS(cos, nextMarker);
        for (const e of data.Contents) {
            let p = e.Key.substring(cos.remotePath.length);
            for (;p[0] === '/';) {
                p = p.substring(1);
            }
            files.add(p);
        }
        nextMarker = data.NextMarker;
    } while (data.IsTruncated === 'true');

    return files;
}


const findDeletedFiles = (localFiles, remoteFiles) => {
    const deletedFiles = new Set();
    for (const file of remoteFiles) {
        if (!localFiles.has(file)) {
            deletedFiles.add(file);
        }
    }
    return deletedFiles;
}

const cleanDeleteFiles = async (cos, deleteFiles) => {
    const size = deleteFiles.size;
    let index = 0;
    let percent = 0;
    for (const file of deleteFiles) {
        await deleteFileFromCOS(cos, file);
        index++;
        percent = parseInt(index / size * 100);
        console.log(`>> [${index}/${size}, ${percent}%] cleaned ${Path.join(cos.remotePath, file)}`);
    }
}

const process = async (cos) => {
    const localFiles = await collectLocalFiles(cos);
    console.log(localFiles.size, 'files to be uploaded');
    await uploadFiles(cos, localFiles);
    let cleanedFilesCount = 0;
    if (cos.clean) {
        const remoteFiles = await collectRemoteFiles(cos);
        const deletedFiles = findDeletedFiles(localFiles, remoteFiles);
        if (deletedFiles.size > 0) {
            console.log(`${deletedFiles.size} files to be cleaned`);
        }
        await cleanDeleteFiles(cos, deletedFiles);
        cleanedFilesCount = deletedFiles.size;
    }
    let cleanedFilesMessage = '';
    if (cleanedFilesCount > 0) {
        cleanedFilesMessage = `, cleaned ${cleanedFilesCount} files`;
    }
    console.log(`uploaded ${localFiles.size} files${cleanedFilesMessage}`);
}

try {
    const cos = {
        cli:  new COS({
            getAuthorization: function (options, callback) {
                var bodyJSON = JSON.stringify({
                    channel: 'OSS_FULL',
                    scopes: ['*']
                });
                var apiUrl = '/auth/tmp_token.json'; 
                var signStr = apiUrl + '\n' + bodyJSON;
                var sign = crypto.createHmac('sha1', core.getInput('secret_key')).update(Buffer.from(signStr, 'utf8')).digest('hex');
                var authorization = 'TOKEN ' + core.getInput('access_key') + ':' + sign;
                
                request({
                    url: 'https://api.dogecloud.com' + apiUrl,
                    method: 'POST',
                    body: bodyJSON,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': authorization
                    }
                }, function (err, response, body) {
                    if (err) { console.log('Request Error'); return }
                    body = JSON.parse(body);
                    if (body.code !== 200) { console.log(JSON.stringify({error: 'API Error: ' + body.msg})); return }
                    var data = body && body.data;
                    const credentials = data.Credentials;
                    callback({
                        TmpSecretId: credentials.accessKeyId,
                        TmpSecretKey: credentials.secretAccessKey,
                        XCosSecurityToken: credentials.sessionToken,
                        ExpiredTime: data.ExpiredAt,
                    });
                });
            },
            Domain: core.getInput('accelerate') === 'true' ? '{Bucket}.cos.accelerate.myqcloud.com' : undefined,
        }),
        bucket: core.getInput('bucket'),
        region: core.getInput('region'),
        localPath: core.getInput('local_path'),
        remotePath: core.getInput('remote_path'),
        clean: core.getInput('clean') === 'true'
    };

    process(cos).catch((reason) => {
        core.setFailed(`fail to upload files to cos: ${reason.message}`);
    });
} catch (error) {
    core.setFailed(error.message);
}
