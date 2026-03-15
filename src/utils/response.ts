// Response helper functions

export function successResponse<T>(data: T, message = 'Success', meta?: any) {
  return {
    success: true,
    message,
    data,
    ...(meta && { meta }),
  };
}

export function errorResponse(message: string, error?: string, statusCode = 400) {
  return {
    success: false,
    message,
    ...(error && { error }),
    statusCode,
  };
}

export function paginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
  message = 'Success'
) {
  const totalPages = Math.ceil(total / limit);
  
  return {
    success: true,
    message,
    data,
    meta: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
}
