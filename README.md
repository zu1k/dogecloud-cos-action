# cos-action

Github Action to upload to DogeCloud COS

## Inputs

### `access_key`

**Required** DogeCloud access key. Should be referred to a encrypted environment variable.

### `secret_key`

**Required** DogeCloud secret key. Should be referred to a encrypted environment variable.

### `bucket`

**Required** COS bucket name.

### `region`

**Required** COS bucket region.

### `local_path`

**Required** Local path to be uploaded to COS. Directory or file is allowed.

### `remote_path`

**Required** COS path to put the local files in on COS.

### `clean`

**Optional** Set to true for cleaning files on COS path which are not existed in local path. Default is false.

### `accelerate`

**Optional** Set to true for using accelerate domain to upload files. Default is false.

## Example usage

```
uses: zu1k/dogecloud-cos-action@v0.1
with:
  access_key: ${{ secrets.ACCESS_KEY }}
  secret_key: ${{ secrets.SECRET_KEY }}
  bucket: ${{ secrets.BUCKET }}
  region: ${{ secrets.REGION }}
  local_path: build
  remote_path: docroot/static
  clean: true
  accelerate: false
```
