// /** ********************************************************************************
//     Copyright 2024 Subteno - Timothée Vannier (https://www.subteno.com).
//     License LGPL-3.0 or later (http://www.gnu.org/licenses/lgpl).
//  **********************************************************************************/
import {KanbanRecord} from "@web/views/kanban/kanban_record";
import {useEffect} from "@odoo/owl";
import {useFileViewer} from "@web/core/file_viewer/file_viewer_hook";
import {useService} from "@web/core/utils/hooks";

const videoReadableTypes = ["x-matroska", "mp4", "webm"];
const audioReadableTypes = ["mp3", "ogg", "wav", "aac", "mpa", "flac", "m4a"];

export class FileKanbanRecord extends KanbanRecord {
    setup() {
        super.setup();
        this.store = useService("mail.store");
        this.fileViewer = useFileViewer();

        useEffect(
            (el) => {
                if (!el) {
                    return;
                }
                el.setAttribute("draggable", "true");
                // Disable native drag on inner images (thumbnail, avatar).
                // Dragging an <img> makes Chrome expose a "Files" entry on the
                // dataTransfer, which would trigger the upload drop zone and
                // re-upload the thumbnail as a duplicate file on drop.
                for (const img of el.querySelectorAll("img")) {
                    img.setAttribute("draggable", "false");
                }
                const onDragStart = this.onDragStart.bind(this);
                const onDragEnd = this.onDragEnd.bind(this);
                el.addEventListener("dragstart", onDragStart);
                el.addEventListener("dragend", onDragEnd);
                return () => {
                    el.removeAttribute("draggable");
                    el.removeEventListener("dragstart", onDragStart);
                    el.removeEventListener("dragend", onDragEnd);
                };
            },
            () => [this.rootRef.el]
        );
    }

    onDragStart(ev) {
        ev.stopPropagation();
        ev.dataTransfer.effectAllowed = "move";
        ev.dataTransfer.setData(
            "dms_file_ids",
            JSON.stringify([this.props.record.data.id])
        );

        // Replace the default bulky card ghost with a compact label showing the file name
        const dragImage = document.createElement("div");
        dragImage.className = "o_dms_drag_image";
        dragImage.textContent = this.props.record.data.name;
        // Must be in DOM for setDragImage, but hidden from normal layout
        dragImage.style.cssText = "position:fixed;top:-1000px;left:0;";
        document.body.appendChild(dragImage);
        ev.dataTransfer.setDragImage(dragImage, 0, 0);
        setTimeout(() => dragImage.remove(), 0);

        // Signal the controller so it can reveal the trash drop target.
        this.env.bus.trigger("dms_drag_start");
    }

    onDragEnd() {
        this.env.bus.trigger("dms_drag_end");
    }

    isVideo(mimetype) {
        return videoReadableTypes.includes(mimetype);
    }

    isAudio(mimetype) {
        return audioReadableTypes.includes(mimetype);
    }

    /**
     * @override
     *
     * Override to open the preview upon clicking the image, if compatible.
     */
    onGlobalClick(ev) {
        const self = this;

        if (ev.target.closest(".o_kanban_dms_file_preview")) {
            const file_type = self.props.record.data.name.split(".")[1];
            let mimetype = "";

            if (self.isVideo(file_type)) {
                mimetype = `video/${file_type}`;
            } else if (self.isAudio(file_type)) {
                mimetype = "audio/mpeg";
            } else {
                mimetype = self.props.record.data.mimetype;
            }

            const attachment = this.store.Attachment.insert({
                id: self.props.record.data.id,
                filename: self.props.record.data.name,
                name: self.props.record.data.name,
                mimetype: mimetype,
                model_name: self.props.record.resModel,
            });
            this.fileViewer.open(attachment);
            return;
        }
        return super.onGlobalClick(ev);
    }
}
