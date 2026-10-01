/**
 * GraphQL Schema
 * 
 * Defines the GraphQL schema for the API.
 * Includes types, queries, mutations, and subscriptions.
 *
 * Phase 7B: Replaced require('apollo-server-express') with graphql's built-in parse.
 * graphql is already a direct dependency — no new package needed.
 * The schema string is passed directly; makeExecutableSchema in server.js accepts
 * both parsed DocumentNode and plain string typeDefs.
 */

// graphql is a direct HALQA dependency (graphql@16.14.2)
const { parse } = require('graphql');

// gql-compatible helper using graphql's own parse
function gql(strings, ...values) {
  const str = strings.reduce((acc, s, i) => acc + s + (values[i] || ''), '');
  return parse(str);
}

const typeDefs = gql`
  # Scalars
  scalar Date
  scalar DateTime
  scalar Upload

  # Types
  type User {
    id: ID!
    email: String!
    firstName: String!
    lastName: String!
    role: String!
    schoolId: String
    school: School
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type School {
    id: ID!
    name: String!
    address: String
    city: String
    country: String
    phone: String
    email: String
    createdAt: DateTime!
    updatedAt: DateTime!
    users: [User!]!
  }

  type Session {
    id: ID!
    userId: String!
    user: User
    deviceFingerprint: String!
    deviceType: String
    deviceName: String
    ipAddress: String
    isActive: Boolean!
    lastAccessedAt: DateTime
    terminatedAt: DateTime
    terminationReason: String
    createdAt: DateTime!
  }

  type Post {
    id: ID!
    title: String!
    content: String!
    authorId: String!
    author: User
    schoolId: String
    school: School
    tags: [String!]!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  # Input Types
  input CreateUserInput {
    email: String!
    firstName: String!
    lastName: String!
    password: String!
    role: String!
    schoolId: String
  }

  input UpdateUserInput {
    email: String
    firstName: String
    lastName: String
    role: String
    schoolId: String
  }

  input CreateSchoolInput {
    name: String!
    address: String
    city: String
    country: String
    phone: String
    email: String
  }

  input UpdateSchoolInput {
    name: String
    address: String
    city: String
    country: String
    phone: String
    email: String
  }

  input CreatePostInput {
    title: String!
    content: String!
    schoolId: String
    tags: [String!]!
  }

  input UpdatePostInput {
    title: String
    content: String
    tags: [String!]
  }

  # Query Response Types
  type PaginatedUsers {
    users: [User!]!
    total: Int!
    page: Int!
    pageSize: Int!
  }

  type PaginatedPosts {
    posts: [Post!]!
    total: Int!
    page: Int!
    pageSize: Int!
  }

  # Queries
  type Query {
    # User queries
    me: User
    user(id: ID!): User
    users(page: Int, pageSize: Int, schoolId: ID): PaginatedUsers!
    
    # School queries
    school(id: ID!): School
    schools(page: Int, pageSize: Int): PaginatedUsers!
    
    # Post queries
    post(id: ID!): Post
    posts(page: Int, pageSize: Int, schoolId: ID, authorId: ID): PaginatedPosts!
    searchPosts(query: String!, page: Int, pageSize: Int): PaginatedPosts!
    
    # Session queries
    mySessions: [Session!]!
    session(id: ID!): Session
    
    # Health check
    health: String!
  }

  # Mutations
  type Mutation {
    # User mutations
    createUser(input: CreateUserInput!): User!
    updateUser(id: ID!, input: UpdateUserInput!): User!
    deleteUser(id: ID!): Boolean!
    
    # School mutations
    createSchool(input: CreateSchoolInput!): School!
    updateSchool(id: ID!, input: UpdateSchoolInput!): School!
    deleteSchool(id: ID!): Boolean!
    
    # Post mutations
    createPost(input: CreatePostInput!): Post!
    updatePost(id: ID!, input: UpdatePostInput!): Post!
    deletePost(id: ID!): Boolean!
    
    # Session mutations
    terminateSession(id: ID!): Boolean!
    terminateAllSessions: Boolean!
  }

  # Subscriptions
  type Subscription {
    userCreated: User!
    userUpdated: User!
    userDeleted: ID!
    
    postCreated: Post!
    postUpdated: Post!
    postDeleted: ID!
  }
`;

module.exports = typeDefs;
