<?php

namespace Lightvel\Support;

/**
 * Generates __patch payloads for efficient client-side array mutations.
 *
 * Instead of re-fetching entire lists from the server after CRUD operations,
 * patch operations tell the JS runtime to surgically insert/update/delete
 * specific items in the client-side state array.
 *
 * Usage in component action methods:
 *   return [...patch()->insert('users', $user)];   // Add item to top of users array
 *   return [...patch()->update('users', $user)];   // Update matching item by id
 *   return [...patch()->delete('users', $id)];     // Remove item by id
 *
 * The returned array contains a __patch key with operation instructions.
 * This is detected by lightvel.js update() function, which calls
 * applyPatchOperations() to modify the client-side state without a full refresh.
 *
 * After applying patches, the JS runtime calls refreshCurrentComponent()
 * to re-render light:for templates with the updated data.
 *
 * @see resources/js/lightvel.js — applyPatchOperations() processes __patch
 * @see resources/js/lightvel.js — findPatchItemId() matches items by 'id' field
 * @see \Lightvel\helpers::patch() — global helper function to create instances
 */
class Patch
{
    /**
     * Normalize an item (Eloquent model, object, or array) into a plain array.
     * Prefers attributesToArray() for Eloquent models (hides hidden fields).
     */
    protected function normalizeItemPayload(mixed $item): array
    {
        if (is_array($item)) {
            return $item;
        }

        if (is_object($item)) {
            // Eloquent model — use attributesToArray() to respect $hidden/$visible
            if (method_exists($item, 'attributesToArray')) {
                $payload = $item->attributesToArray();
                return is_array($payload) ? $payload : [];
            }

            // Any object with toArray() (collections, DTOs, etc.)
            if (method_exists($item, 'toArray')) {
                $payload = $item->toArray();
                return is_array($payload) ? $payload : [];
            }

            return get_object_vars($item);
        }

        return [];
    }

    /**
     * Generate a delete patch — removes item by ID from client-side array.
     * JS: applyPatchOperations() filters out items matching this ID.
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
     * Generate an update patch — merges new data into existing item by ID.
     * JS: applyPatchOperations() finds the item by ID and spreads updated fields.
     */
    public function update(string $resource, mixed $item): array
    {
        return [
            '__patch' => [
                $resource => [
                    'update' => [$this->normalizeItemPayload($item)],
                ],
            ],
        ];
    }

    /**
     * Generate an insert patch — prepends item to the client-side array.
     * JS: applyPatchOperations() adds the item at the beginning, deduplicating by ID.
     */
    public function insert(string $resource, mixed $item): array
    {
        return [
            '__patch' => [
                $resource => [
                    'insert' => [$this->normalizeItemPayload($item)],
                ],
            ],
        ];
    }
}
