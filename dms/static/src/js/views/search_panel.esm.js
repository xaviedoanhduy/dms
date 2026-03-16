/* Copyright 2021-2024 Tecnativa - Víctor Martínez
 * Copyright 2024 Subteno - Timothée Vannier (https://www.subteno.com).
 * License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl). */

import {SearchModel} from "@web/search/search_model";
import {SearchPanel} from "@web/search/search_panel/search_panel";
import {_t} from "@web/core/l10n/translation";
import {patch} from "@web/core/utils/patch";
import {useService} from "@web/core/utils/hooks";

patch(SearchModel.prototype, {
    _getCategoryDomain(excludedCategoryId) {
        const domain = super._getCategoryDomain(...arguments);
        for (const category of this.categories) {
            if (category.id === excludedCategoryId) {
                continue;
            }

            // Make sure to filter selected category only for DMS hierarchies,
            // not other Odoo models such as product categories
            // where child_of could be better than "=" operator
            if (category.activeValueId && this.resModel.startsWith("dms")) {
                domain.push([category.fieldName, "=", category.activeValueId]);
            }
            if (domain.length === 0 && this.resModel === "dms.directory") {
                domain.push([category.fieldName, "=", false]);
            }
        }
        return domain;
    },
});

export class DmsSearchPanel extends SearchPanel {
    static subTemplates = {
        ...SearchPanel.subTemplates,
        category: "dms.SearchPanel.Category",
    };

    setup() {
        super.setup();
        this.orm = useService("orm");
        this.notification = useService("notification");
        this.actionService = useService("action");
    }

    /**
     * Adds/removes the drag-over highlight class on search panel category items.
     * @param {HTMLElement|null} newDragFocus
     */
    updateDragOverClass(newDragFocus) {
        for (const el of this.root.el.querySelectorAll(".o_dms_drag_over_folder")) {
            el.classList.remove("o_dms_drag_over_folder");
        }
        if (newDragFocus) {
            newDragFocus.classList.add("o_dms_drag_over_folder");
        }
    }

    onDragEnter(section, value, ev) {
        if (!ev.dataTransfer.types.includes("dms_file_ids")) {
            return;
        }
        this.updateDragOverClass(ev.currentTarget);
    }

    onDragLeave(section, ev) {
        if (!ev.dataTransfer.types.includes("dms_file_ids")) {
            return;
        }
        // Only clear the highlight when leaving to an element outside the folder item
        if (!ev.currentTarget.contains(ev.relatedTarget)) {
            this.updateDragOverClass(null);
        }
    }

    onDragOver(section, value, ev) {
        if (!ev.dataTransfer.types.includes("dms_file_ids")) {
            return;
        }
        ev.dataTransfer.dropEffect = "move";
    }

    async onDrop(section, value, ev) {
        this.updateDragOverClass(null);
        if (!ev.dataTransfer.types.includes("dms_file_ids")) {
            return;
        }
        const targetDirectoryId = value.id;
        if (!targetDirectoryId || typeof targetDirectoryId !== "number") {
            return;
        }
        // Dropping onto the currently active folder is a no-op and causes a visual glitch
        if (targetDirectoryId === section.activeValueId) {
            return;
        }
        let fileIds = null;
        try {
            fileIds = JSON.parse(ev.dataTransfer.getData("dms_file_ids"));
        } catch {
            return;
        }
        if (!fileIds || !fileIds.length) {
            return;
        }
        const controllerID = this.actionService.currentController?.jsId;
        try {
            await this.orm.write("dms.file", fileIds, {
                directory_id: targetDirectoryId,
            });
        } catch (e) {
            this.notification.add(
                e.data?.message || _t("An error occurred while moving the file(s)"),
                {type: "danger"}
            );
            return;
        }
        this.notification.add(_t("File(s) moved successfully"), {type: "success"});
        // Refresh the search panel folder counters (they are not recomputed by
        // a plain controller restore).
        await this.env.searchModel._notify();
        if (controllerID) {
            this.actionService.restore(controllerID);
        }
    }
}
