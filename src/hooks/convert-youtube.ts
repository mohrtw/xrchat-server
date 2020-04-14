/* eslint-disable @typescript-eslint/restrict-plus-operands */
// @ts-ignore
import config from 'config'
// @ts-ignore
import youtubedl from 'youtube-dl'
import AWS from 'aws-sdk'
// @ts-ignore
import S3BlobStore from 's3-blob-store'
import { Application } from '../declarations'

import ffmpeg from 'fluent-ffmpeg'
import fs from 'fs'
import { binPath } from 'bento4-installer'
import bento4 from 'fluent-bento4'

const bento = bento4.setBinPath(binPath)

const re = /v=([a-zA-Z0-9]+)$/

const s3 = new AWS.S3({
  accessKeyId: config.get('aws.keys.access_key_id') ?? '',
  secretAccessKey: config.get('aws.keys.secret_access_key') ?? ''
})

const s3BlobStore = new S3BlobStore({
  client: s3,
  bucket: config.get('aws.s3.public_video_bucket') || 'default'
})

export default async function (data: any): Promise<void> {
  const results = data.result
  const app = data.app

  results.map(async function (result: any) {
    return await uploadVideo(result, app)
  })
}

async function uploadVideo (result: any, app: Application): Promise<any> {
  return await new Promise(function (resolve, reject) {
    const link = result.link
    const fileId = link.match(re)[1]

    const options = {
      key: (fileId as string) + '.webm'
    }

    s3BlobStore.exists(options, async function (err: any, exists: any) {
      if (err) {
        throw err
      }

      if (exists !== true) {
        try {
          const video = youtubedl(link,
            ['--format=(webm)[abr<=3000,height<=1080]'],
            { cwd: __dirname })

          video.on('error', function (err: any) {
            throw err
          })

          // eslint-disable-next-line @typescript-eslint/no-misused-promises
          video.on('info', async function (info: any): Promise<void> {
            const stream = s3BlobStore.createWriteStream(options)

            video.pipe(stream)

            stream.on('finish', async function (): Promise<void> {
              var outStream = fs.createWriteStream('output.mp4')

              ffmpeg(stream.path, { presets: './ffmpeg' }).preset('mse').pipe(outStream)
                // eslint-disable-next-line @typescript-eslint/no-misused-promises
                .on('end', async function (): Promise<void> {
                  bento.mp4dash.exec(outStream.path)
                  await app.service('public-video').patch(result.id, {
                    link: 'https://' +
                        config.get('aws.s3.public_video_bucket') +
                        '.s3.amazonaws.com/' +
                        options.key
                  })

                  resolve()
                })
            })
          })
        } catch (err) {
          console.log(err)

          reject(err)
        } finally {
          fs.unlink('output.mp4', (err) => {
            if (err) throw err
          })
          await fs.promises.rmdir('output', { recursive: true })
        }
      } else {
        await app.service('public-video').patch(result.id, {
          link: 'https://' +
              config.get('aws.s3.public_video_bucket') +
              '.s3.amazonaws.com/' +
              options.key
        })

        resolve()
      }
    })
  })
}
