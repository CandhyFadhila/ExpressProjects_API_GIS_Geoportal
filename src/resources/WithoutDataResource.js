class WithoutDataResource {
  constructor(status, caseType = null, title, description) {
    this.status = status;
    this.case = caseType;
    this.title = title;
    this.description = description;
  }

  toResponse() {
    return {
      status: this.status,
      case: this.case,
      message: {
        title: this.title,
        description: this.description,
      },
    };
  }
}

module.exports = WithoutDataResource;
