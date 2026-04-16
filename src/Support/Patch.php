<?php

namespace Lightvel\Support;

/**
 * Generates __patch payloads for surgical client-side array mutations.
 *
 * Usage (all operations send minimal data — no full model serialization):
 *
 *   patch()->delete('users', $id)
 *     → Removes item with matching ID from client array
 *
 *   patch()->update('users', $id, $validated)
 *     → Updates item with matching ID using given fields
 *     → Example: patch()->update('users', 5, ['name' => 'New Name', 'email' => 'new@test.com'])
 *
 *   patch()->insert('users', $id, $validated)
 *     → Prepends new item with given ID + fields to client array
 *     → Example: patch()->insert('users', 123, ['name' => 'John', 'email' => 'john@test.com'])
 *
 * @see resources/js/lightvel.js — applyPatchOperations() handles __patch
 */
class Patch
{
    /**
     * Delete item by ID from client-side array.
     */
    public function delete(string $resource, int|string $id): array
    {
        return [
            '__patch' => [
                $resource => [
                    'delete' => [$id],
                ],
            ],
        ];
    }

    /**
     * Update item by ID with given fields.
     * Only the specified fields are merged into the existing item.
     */
    public function update(string $resource, int|string $id, array $fields): array
    {
        return [
            '__patch' => [
                $resource => [
                    'update' => [
                        array_merge(['id' => $id], $fields),
                    ],
                ],
            ],
        ];
    }

    /**
     * Insert new item with given ID + fields.
     * Item is prepended to the array, duplicates are removed.
     */
    public function insert(string $resource, int|string $id, array $fields): array
    {
        return [
            '__patch' => [
                $resource => [
                    'insert' => [
                        array_merge(['id' => $id], $fields),
                    ],
                ],
            ],
        ];
    }
}
