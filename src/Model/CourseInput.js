/**
 * Data sent when a course input is submitted.
 * @typedef {object} CourseInputRequest
 * @property {string} text
 */

/**
 * A course input stored locally or returned by the backend.
 * @typedef {CourseInputRequest & {id?: string, submittedAt?: string, createdAt?: string}} CourseInput
 */

export {}