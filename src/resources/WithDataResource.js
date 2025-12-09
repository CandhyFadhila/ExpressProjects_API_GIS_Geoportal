class WithDataResource {
  constructor(status, caseType = null, title, description, data = null) {
    this.status = status;
    this.case = caseType;
    this.title = title;
    this.description = description;
    this.data = data;
  }

  toResponse() {
    return {
      status: this.status,
      case: this.case,
      message: {
        title: this.title,
        description: this.description,
      },
      data: this.data,
    };
  }
}

module.exports = WithDataResource;
