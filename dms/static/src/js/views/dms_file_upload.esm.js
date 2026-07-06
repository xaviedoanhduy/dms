// /** ********************************************************************************
//     Copyright 2024 Subteno - Timothée Vannier (https://www.subteno.com).
//     License LGPL-3.0 or later (http://www.gnu.org/licenses/lgpl).
//  **********************************************************************************/

import {useBus, useService} from "@web/core/utils/hooks";
import {useEffect, useRef, useState} from "@odoo/owl";
import {ConfirmationDialog} from "@web/core/confirmation_dialog/confirmation_dialog";
import {_t} from "@web/core/l10n/translation";

export function createFileDropZoneExtension() {
    return {
        setup() {
            super.setup(...arguments);
            this.dragState = useState({
                showDragZone: false,
            });
            this.root = useRef("root");

            useEffect(
                (el) => {
                    if (!el) {
                        return;
                    }
                    const highlight = this.highlight.bind(this);
                    const unhighlight = this.unhighlight.bind(this);
                    const drop = this.onDrop.bind(this);
                    el.addEventListener("dragover", highlight);
                    el.addEventListener("dragleave", unhighlight);
                    el.addEventListener("drop", drop);
                    return () => {
                        el.removeEventListener("dragover", highlight);
                        el.removeEventListener("dragleave", unhighlight);
                        el.removeEventListener("drop", drop);
                    };
                },

                () => [document.querySelector(".o_content")]
            );
        },

        highlight(ev) {
            if (!this._isExternalFileDrag(ev)) {
                return;
            }
            ev.stopPropagation();
            ev.preventDefault();
            this.dragState.showDragZone = true;
        },

        unhighlight(ev) {
            ev.stopPropagation();
            ev.preventDefault();
            this.dragState.showDragZone = false;
        },

        async onDrop(ev) {
            if (!this._isExternalFileDrag(ev)) {
                return;
            }
            ev.preventDefault();
            this.dragState.showDragZone = false;
            await this.env.bus.trigger("change_file_input", {
                files: ev.dataTransfer.files,
            });
        },

        _isExternalFileDrag(ev) {
            const types = ev.dataTransfer && ev.dataTransfer.types;
            if (!types) {
                return false;
            }
            // Ignore internal kanban card drags (moving files to a folder); they
            // carry a "dms_file_ids" payload. Only react to real external files.
            if (types.includes("dms_file_ids")) {
                return false;
            }
            return types.includes("Files");
        },
    };
}

export function createFileUploadExtension() {
    return {
        setup() {
            super.setup();
            this.notification = useService("notification");
            this.orm = useService("orm");
            this.http = useService("http");
            this.dialog = useService("dialog");
            this.fileInput = useRef("fileInput");

            // Shown only while a kanban card is being dragged, so the trash drop
            // target only appears when it can actually be used.
            this.dmsDragState = useState({dragging: false});
            useBus(this.env.bus, "dms_drag_start", () => {
                this.dmsDragState.dragging = true;
            });
            useBus(this.env.bus, "dms_drag_end", () => {
                this.dmsDragState.dragging = false;
            });

            useBus(this.env.bus, "change_file_input", async (ev) => {
                this.fileInput.el.files = ev.detail.files;
                await this.onChangeFileInput();
            });
        },

        uploadDocument() {
            this.fileInput.el.click();
        },

        async onChangeFileInput() {
            const self = this;
            const controllerID = this.actionService.currentController.jsId;
            // Search the correct directory_id value according to the domain
            let directory_id = false;
            if (this.props.domain) {
                for (const domain_item of this.props.domain) {
                    if (domain_item.length === 3) {
                        if (
                            domain_item[0] === "directory_id" &&
                            ["=", "child_of"].includes(domain_item[1])
                        ) {
                            directory_id = domain_item[2];
                        }
                    }
                }
            }

            if (directory_id === false) {
                self.actionService.restore(controllerID);
                return self.notification.add(_t("You must select a directory first"), {
                    type: "danger",
                });
            }

            const params = {
                csrf_token: odoo.csrf_token,
                ufile: [...this.fileInput.el.files],
                directory_id: directory_id,
            };

            const fileData = await this.http.post(
                "/web/binary/upload_dms_file",
                params,
                "text"
            );
            const result = JSON.parse(fileData);
            if (result.error) {
                throw new Error(result.error);
            }
            self.actionService.restore(controllerID);
            self.notification.add(_t("File(s) uploaded successfully"), {
                type: "success",
            });
            // Refresh the search panel folder counters.
            await self.env.searchModel._notify();
        },

        onTrashDragEnter(ev) {
            if (!ev.dataTransfer.types.includes("dms_file_ids")) {
                return;
            }
            ev.currentTarget.classList.add("o_dms_trash_drop_over");
        },

        onTrashDragOver(ev) {
            if (!ev.dataTransfer.types.includes("dms_file_ids")) {
                return;
            }
            ev.dataTransfer.dropEffect = "move";
        },

        onTrashDragLeave(ev) {
            ev.currentTarget.classList.remove("o_dms_trash_drop_over");
        },

        onTrashDrop(ev) {
            ev.currentTarget.classList.remove("o_dms_trash_drop_over");
            if (!ev.dataTransfer.types.includes("dms_file_ids")) {
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
            this.dialog.add(ConfirmationDialog, {
                title: _t("Delete file(s)"),
                body: _t("Are you sure you want to delete the selected file(s)?"),
                confirmLabel: _t("Delete"),
                confirm: async () => {
                    try {
                        await this.orm.unlink("dms.file", fileIds);
                    } catch (e) {
                        this.notification.add(
                            e.data?.message ||
                                _t("An error occurred while deleting the file(s)"),
                            {type: "danger"}
                        );
                        return;
                    }
                    this.notification.add(_t("File(s) deleted successfully"), {
                        type: "success",
                    });
                    // Refresh the search panel folder counters.
                    await this.env.searchModel._notify();
                    if (controllerID) {
                        this.actionService.restore(controllerID);
                    }
                },
            });
        },
    };
}
