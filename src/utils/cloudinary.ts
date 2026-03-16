import { v2 as cloudinary } from 'cloudinary';
import { config } from '../config';

// Configure Cloudinary
cloudinary.config({
  cloud_name: config.cloudinary.cloudName,
  api_key: config.cloudinary.apiKey,
  api_secret: config.cloudinary.apiSecret,
});

export interface UploadResult {
  url: string;
  publicId: string;
  width?: number;
  height?: number;
  format?: string;
  resourceType?: string;
}

/**
 * Upload an image to Cloudinary
 */
export async function uploadImage(
  fileBuffer: Buffer,
  folder: string,
  filename?: string
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: filename,
        resource_type: 'image',
        transformation: [
          { quality: 'auto:good' },
          { fetch_format: 'auto' },
        ],
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else if (result) {
          resolve({
            url: result.secure_url,
            publicId: result.public_id,
            width: result.width,
            height: result.height,
            format: result.format,
            resourceType: result.resource_type,
          });
        } else {
          reject(new Error('Upload failed - no result'));
        }
      }
    );
    
    uploadStream.end(fileBuffer);
  });
}

/**
 * Upload a video to Cloudinary
 */
export async function uploadVideo(
  fileBuffer: Buffer,
  folder: string,
  filename?: string
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: filename,
        resource_type: 'video',
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else if (result) {
          resolve({
            url: result.secure_url,
            publicId: result.public_id,
            width: result.width,
            height: result.height,
            format: result.format,
            resourceType: result.resource_type,
          });
        } else {
          reject(new Error('Upload failed - no result'));
        }
      }
    );
    
    uploadStream.end(fileBuffer);
  });
}

/**
 * Upload any file (auto-detects type)
 */
export async function uploadFile(
  fileBuffer: Buffer,
  folder: string,
  filename?: string,
  resourceType: 'image' | 'video' | 'raw' = 'image'
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: filename,
        resource_type: resourceType,
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else if (result) {
          resolve({
            url: result.secure_url,
            publicId: result.public_id,
            width: result.width,
            height: result.height,
            format: result.format,
            resourceType: result.resource_type,
          });
        } else {
          reject(new Error('Upload failed - no result'));
        }
      }
    );
    
    uploadStream.end(fileBuffer);
  });
}

/**
 * Delete a file from Cloudinary
 */
export async function deleteFile(publicId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.destroy(publicId, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Get optimized image URL with transformations
 */
export function getOptimizedImageUrl(
  url: string,
  options: { width?: number; height?: number; crop?: string } = {}
): string {
  const { width, height, crop = 'fill' } = options;
  
  if (!url.includes('cloudinary.com')) {
    return url;
  }
  
  let transformations = 'f_auto,q_auto';
  if (width) transformations += `,w_${width}`;
  if (height) transformations += `,h_${height}`;
  if (width || height) transformations += `,c_${crop}`;
  
  return url.replace('/upload/', `/upload/${transformations}/`);
}

export { cloudinary };
